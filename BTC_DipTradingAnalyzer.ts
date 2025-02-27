import * as fs from 'fs';
import * as csv from 'csv-parse';

interface BTCData {
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

interface Purchase {
    date: Date;
    price: number;
    allTimeHigh: number;
    btcPurchased: number;
    dollarsSpent: number;
    totalBtcAfterPurchase: number;
}

interface Sale {
    date: Date;
    price: number;
    allTimeHigh: number;
    btcSold: number;
    dollarsReceived: number;
    btcRemaining: number;
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

async function analyzeDipsAndTrade(
    data: BTCData[],
    dipFraction: number,
    profitFraction: number,
    dollarAmount: number,
    sellFraction: number
): Promise<[Purchase[], Sale[]]> {
    if (!(dipFraction > 0 && dipFraction < 1)) {
        throw new Error("Dip fraction must be between 0 and 1");
    }
    if (profitFraction <= 1) {
        throw new Error("Profit fraction must be greater than 1");
    }
    if (!(sellFraction > 0 && sellFraction <= 1)) {
        throw new Error("Sell fraction must be between 0 and 1");
    }

    const purchases: Purchase[] = [];
    const sales: Sale[] = [];
    let allTimeHigh = 0;
    let currentBtcHoldings = 0;
    let allowPurchase = false;
    let readyToSell = false;
    let sellTarget = Number.MAX_VALUE;

    for (const row of data) {
        // Update all-time high if we see a new one
        if (row.high > allTimeHigh) {
            allTimeHigh = row.high;
            allowPurchase = true;
        }

        // Check for selling conditions first
        if (readyToSell && currentBtcHoldings > 0 && row.high >= sellTarget) {
            // Sell specified fraction of current BTC holdings
            const btcToSell = currentBtcHoldings * sellFraction;
            const dollarsReceived = btcToSell * row.high;
            sales.push({
                date: row.date,
                price: row.high,
                allTimeHigh: allTimeHigh,
                btcSold: btcToSell,
                dollarsReceived: dollarsReceived,
                btcRemaining: currentBtcHoldings - btcToSell
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
            const btcAmount = purchaseAmount / row.low;
            purchases.push({
                date: row.date,
                price: row.low,
                allTimeHigh: allTimeHigh,
                btcPurchased: btcAmount,
                dollarsSpent: dollarAmount,
                totalBtcAfterPurchase: currentBtcHoldings + btcAmount
            });
            currentBtcHoldings += btcAmount;
            allowPurchase = false;
            readyToSell = true;
            sellTarget = allTimeHigh * profitFraction;
        }
    }

    return [purchases, sales];
}

async function loadBtcData(filename: string): Promise<BTCData[]> {
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

async function main() {
    const filename = "Poloniex_BTCUSDT_1h.csv";
    const dipFraction = 0.98;  // Buy when price dips to 97.5% of ATH
    const profitFraction = 1.01;  // Sell when price exceeds ATH by 2%
    const dollarAmount = 1000;  // Spend $1000 on each dip
    const sellFraction = 0.10;  // Sell 50% of holdings each time
    const printTransactions = false;

    try {
        const data = await loadBtcData(filename);
        const [purchases, sales] = await analyzeDipsAndTrade(
            data,
            dipFraction,
            profitFraction,
            dollarAmount,
            sellFraction
        );

        // Print purchase results
        const totalBtcBought = purchases.reduce((sum, p) => sum + p.btcPurchased, 0);
        const totalSpent = purchases.reduce((sum, p) => sum + p.dollarsSpent, 0);

        console.log(`\nTotal purchases made: ${purchases.length}`);
        console.log(`Total BTC bought: ${totalBtcBought.toFixed(8)}`);
        console.log(`Total USD spent: $${totalSpent.toLocaleString()}`);

        // Print sale results
        const totalBtcSold = sales.reduce((sum, s) => sum + s.btcSold, 0);
        const totalReceived = sales.reduce((sum, s) => sum + s.dollarsReceived, 0);

        console.log(`\nTotal sales made: ${sales.length}`);
        console.log(`Total BTC sold: ${totalBtcSold.toFixed(8)}`);
        console.log(`Total USD received: $${totalReceived.toLocaleString()}`);
        console.log(`Net profit/loss: $${(totalReceived - totalSpent).toLocaleString()}`);

        // Calculate remaining BTC holdings
        const finalBtcHoldings = totalBtcBought - totalBtcSold;
        console.log(`Remaining BTC holdings: ${finalBtcHoldings.toFixed(8)}`);

        if (printTransactions) {

            // Print trading history
            console.log("\nTrading history:");
            console.log("\nPurchases:");
            purchases.forEach(purchase => {
                console.log(
                    `BUY  - Date: ${purchase.date.toISOString()}, ` +
                    `Price: $${purchase.price.toLocaleString()}, ` +
                    `BTC: ${purchase.btcPurchased.toFixed(8)}, ` +
                    `Total BTC: ${purchase.totalBtcAfterPurchase.toFixed(8)}`
                );
            });

            console.log("\nSales:");
            sales.forEach(sale => {
                console.log(
                    `SELL - Date: ${sale.date.toISOString()}, ` +
                    `Price: $${sale.price.toLocaleString()}, ` +
                    `BTC Sold: ${sale.btcSold.toFixed(8)}, ` +
                    `BTC Remaining: ${sale.btcRemaining.toFixed(8)}`
                );
            });
        }
    } catch (error) {
        console.error('An error occurred:', error);
    }
}

main().catch(console.error);