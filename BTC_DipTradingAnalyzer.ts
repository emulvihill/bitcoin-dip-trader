import * as fs from 'fs';
import * as csv from 'csv-parse';

export interface BTCData {
    unixTime: number;
    date: Date;
    symbol: string;
    openPrice: number;
    high: number;
    low: number;
    close: number;
    volumeBtc: number;
    volumeUsdt: number;
    buyTakerAmount: number;
    buyTakerQuantity: number;
    tradeCount: number;
    weightedAverage: number;
}

export interface Purchase {
    date: Date;
    price: number;
    allTimeHigh: number;
    btcPurchased: number;
    dollarsSpent: number;
    totalBtcAfterPurchase: number;
    fees: number;
}

export interface Sale {
    date: Date;
    price: number;
    allTimeHigh: number;
    btcSold: number;
    dollarsReceived: number;
    btcRemaining: number;
    fees: number;
}

export interface DipTradingParameters {
    dipFraction: number;
    profitFraction: number;
    dollarAmount: number;
    sellFraction: number;
    feeRate: number;
    printStats: boolean;
    printTransactions: boolean;
}

export interface DipTradingStatistics {
    purchases: Purchase[];
    sales: Sale[];
    totalBtcBought: number;
    totalBtcSold: number;
    totalSpent: number;
    totalReceived: number;
    totalPurchaseFees: number;
    totalSaleFees: number;
    totalFees: number;
    netProfitLoss: number;
}

function roundTo(num: number, precision: number): number {
    const factor = Math.pow(10, precision)
    return Math.round(num * factor) / factor
}

function createBTCDataFromRow(row: any): BTCData {
    return {
        unixTime: parseInt(row.unix),
        date: new Date(row.date),
        symbol: row.symbol,
        openPrice: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volumeBtc: parseFloat(row['Volume BTC']),
        volumeUsdt: parseFloat(row['Volume USDT']),
        buyTakerAmount: parseFloat(row.buyTakerAmount),
        buyTakerQuantity: parseFloat(row.buyTakerQuantity),
        tradeCount: parseInt(row.tradeCount),
        weightedAverage: parseFloat(row.weightedAverage)
    };
}

export async function loadBtcData(filename: string): Promise<BTCData[]> {
    return new Promise((resolve, reject) => {
        const data: BTCData[] = [];
        fs.createReadStream(filename)
            .pipe(csv.parse({columns: true}))
            .on('data', (row) => {
                data.push(createBTCDataFromRow(row));
            })
            .on('end', () => resolve(data))
            .on('error', (error) => reject(error));
    });
}

export async function analyzeDipsAndTrade(
    data: BTCData[],
    dipFraction: number,
    profitFraction: number,
    dollarAmount: number,
    sellFraction: number,
    feeRate: number
): Promise<[Purchase[], Sale[]]> {

    if (!(dipFraction > 0 && dipFraction < 1)) {
        throw new Error("Dip fraction must be strictly between 0 and 1");
    }
    if (profitFraction <= 1) {
        throw new Error("Profit fraction must be greater than 1");
    }
    if (!(sellFraction >= 0 && sellFraction <= 1)) {
        throw new Error("Sell fraction must be between 0 and 1");
    }

    const purchases: Purchase[] = [];
    const sales: Sale[] = [];
    let allTimeHigh = 0;
    let currentBtcHoldings = 0;
    let allowPurchase = true;
    let readyToSell = false;
    let sellTarget = Number.MAX_VALUE;

    for (const row of data) {
        // Update all-time high if we see a new one
        if (row.high > allTimeHigh) {
            allTimeHigh = row.high;
        }

        // Check for selling conditions first
        if (readyToSell && currentBtcHoldings > 0 && row.high >= sellTarget) {
            // Sell specified fraction of current BTC holdings
            const btcToSell = currentBtcHoldings * sellFraction;
            const grossDollarsReceived = btcToSell * row.high;
            const fees = grossDollarsReceived * feeRate;
            const netDollarsReceived = grossDollarsReceived - fees;

            sales.push({
                date: row.date,
                price: row.high,
                allTimeHigh: allTimeHigh,
                btcSold: btcToSell,
                dollarsReceived: netDollarsReceived,
                btcRemaining: currentBtcHoldings - btcToSell,
                fees: fees
            });
            currentBtcHoldings -= btcToSell;
            readyToSell = false;
            allowPurchase = true;
        }

        // Check for buying conditions
        const dipTarget = allTimeHigh * dipFraction;
        if (allowPurchase && row.low <= dipTarget) {
            // Calculate how much BTC we can buy with our dollar amount
            const purchaseAmount = dollarAmount * Math.log2(sales.length + 2)
            const fees = purchaseAmount * feeRate;
            const netPurchaseAmount = purchaseAmount - fees;
            const btcAmount = netPurchaseAmount / row.low;
            purchases.push({
                date: row.date,
                price: row.low,
                allTimeHigh: allTimeHigh,
                btcPurchased: btcAmount,
                dollarsSpent: netPurchaseAmount,
                totalBtcAfterPurchase: currentBtcHoldings + btcAmount,
                fees: fees
            });
            currentBtcHoldings += btcAmount;
            allowPurchase = false;
            readyToSell = true;
            sellTarget = allTimeHigh * profitFraction;
        }
    }

    return [purchases, sales];
}

export async function calculateProfitLoss(data: BTCData[], parameters: DipTradingParameters): Promise<DipTradingStatistics> {

    const {dipFraction, profitFraction, dollarAmount, sellFraction, feeRate, printStats, printTransactions} = parameters;

    try {
        const [purchases, sales] = await analyzeDipsAndTrade(
            data,
            dipFraction,
            profitFraction,
            dollarAmount,
            sellFraction,
            feeRate
        );

        // Calculate totals including fees
        const totalBtcBought = purchases.reduce((sum, p) => sum + p.btcPurchased, 0);
        const totalSpent = purchases.reduce((sum, p) => sum + p.dollarsSpent, 0);
        const totalPurchaseFees = purchases.reduce((sum, p) => sum + p.fees, 0);

        const totalBtcSold = sales.reduce((sum, s) => sum + s.btcSold, 0);
        const totalReceived = sales.reduce((sum, s) => sum + s.dollarsReceived, 0);
        const totalSaleFees = sales.reduce((sum, s) => sum + s.fees, 0);

        const totalFees = totalPurchaseFees + totalSaleFees;
        const netProfitLoss = totalReceived - totalSpent - totalFees;
        const finalBtcHoldings = totalBtcBought - totalBtcSold;

        // Print results with fee information
        if (printStats) {

            console.log("\nTrading Summary:");
            console.log(`Total purchases made: ${purchases.length}`);
            console.log(`Total BTC bought: ${totalBtcBought.toFixed(8)}`);
            console.log(`Total USD spent: $${totalSpent.toLocaleString()}`);
            console.log(`Total purchase fees: $${totalPurchaseFees.toLocaleString()}`);

            console.log(`\nTotal sales made: ${sales.length}`);
            console.log(`Total BTC sold: ${totalBtcSold.toFixed(8)}`);
            console.log(`Total USD received: $${totalReceived.toLocaleString()}`);
            console.log(`Total sale fees: $${totalSaleFees.toLocaleString()}`);

            console.log(`\nTotal fees paid: $${totalFees.toLocaleString()}`);

            console.log(`Net profit/loss (after fees): $${netProfitLoss.toLocaleString()}`);

            console.log(`Remaining BTC holdings: ${finalBtcHoldings.toFixed(8)}`);
        }

        if (printTransactions) {
            // Print detailed trading history with fees
            console.log("\nDetailed Trading History:");
            console.log("\nPurchases:");
            purchases.forEach(purchase => {
                console.log(
                    `BUY  - Date: ${purchase.date.toISOString()}, ` +
                    `Price: $${purchase.price.toLocaleString()}, ` +
                    `BTC: ${purchase.btcPurchased.toFixed(8)}, ` +
                    `Spent: $${purchase.dollarsSpent.toLocaleString()}, ` +
                    `Fees: $${purchase.fees.toLocaleString()}, ` +
                    `Total BTC: ${purchase.totalBtcAfterPurchase.toFixed(8)}`
                );
            });

            console.log("\nSales:");
            sales.forEach(sale => {
                console.log(
                    `SELL - Date: ${sale.date.toISOString()}, ` +
                    `Price: $${sale.price.toLocaleString()}, ` +
                    `BTC Sold: ${sale.btcSold.toFixed(8)}, ` +
                    `Received: $${sale.dollarsReceived.toLocaleString()}, ` +
                    `Fees: $${sale.fees.toLocaleString()}, ` +
                    `BTC Remaining: ${sale.btcRemaining.toFixed(8)}`
                );
            });
        }

        return {
            totalBtcBought: totalBtcBought,
            totalBtcSold: totalBtcSold,
            totalSpent: roundTo(totalSpent, 2),
            totalReceived: roundTo(totalReceived, 2),
            totalPurchaseFees: roundTo(totalPurchaseFees, 2),
            totalSaleFees: roundTo(totalSaleFees, 2),
            totalFees: roundTo(totalFees, 2),
            netProfitLoss: roundTo(netProfitLoss, 2),
            purchases: purchases,
            sales: sales
        };

    } catch (error) {
        console.error('An error occurred:', error);
    }
}

async function main() {
    const filename = "Poloniex_BTCUSDT_1h.csv";

    const parameters = {
        dipFraction: 0.98,
        profitFraction: 1.01,
        dollarAmount: 1000,
        sellFraction: 0.1,
        feeRate: 0.006,
        printStats: true,
        printTransactions: false
    };

    const data = await loadBtcData(filename);

    const statistics = await calculateProfitLoss(data, parameters);

    const {purchases, sales, ...filteredStats} = statistics;
    console.log(filteredStats);
}

main().catch(console.error);
