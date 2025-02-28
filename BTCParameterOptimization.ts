import {BTCData, calculateProfitLoss, DipTradingParameters, loadBtcData} from "./BTC_DipTradingAnalyzer";

interface OptimizationResult extends DipTradingParameters {
    netProfitLoss: number;
    iterations: number;
}

interface DynamicParams {
    dipFraction: number;
    profitFraction: number;
    sellFraction: number;
}

interface FixedParams {
    dollarAmount: number;
    feeRate: number;
    printStats: boolean;
    printTransactions: boolean;
}

// params to optimize
const dynamicParams: DynamicParams = {
    dipFraction: 0.97,
    profitFraction: 1.05,
    sellFraction: 0.25,
}

// fixed params
const fixedParams: FixedParams = {
    dollarAmount: 1000,
    feeRate: 0.006,
    printStats: false,
    printTransactions: false
};

async function optimizeParameters(
    data: BTCData[],
    learningRate: number,
    maxIterations: number,
    convergenceThreshold: number
): Promise<OptimizationResult> {

    if (!learningRate || !maxIterations || !convergenceThreshold) {
        throw new Error("Learning rate, max iterations, and convergence threshold must be specified");
    }

    // Initial parameters
    let currentParams: DipTradingParameters = {...dynamicParams, ...fixedParams};
    let bestParams: DipTradingParameters = {...currentParams};
    let bestProfit = Number.NEGATIVE_INFINITY;
    let iteration = 0;
    let previousProfit = 0;

    // Gradient descent optimization
    while (iteration < maxIterations) {

        const stats = await calculateProfitLoss(data, currentParams);
        const currentProfit = stats.netProfitLoss;

        // Update the best parameters if we found better profit
        if (currentProfit > bestProfit) {
            bestProfit = currentProfit;
            bestParams = {...currentParams};
        }

        // Check for convergence
        if (Math.abs(currentProfit - previousProfit) < convergenceThreshold) {
            break;
        }

        // Calculate gradients using finite differences
        const epsilon = 0.01; // NB: Calcs can blow up if epsilon is too large
        const gradients = {
            dipFraction: 0,
            profitFraction: 0,
            sellFraction: 0
        };

        // Calculate gradient for dipFraction
        const dipUp = await calculateProfitForParams(data, {
            ...currentParams,
            dipFraction: currentParams.dipFraction + epsilon
        });

        const dipDown = await calculateProfitForParams(data, {
            ...currentParams,
            dipFraction: currentParams.dipFraction - epsilon
        });

        gradients.dipFraction = (dipUp - dipDown) / (2 * epsilon);

        // Calculate gradient for profitFraction
        const profitUp = await calculateProfitForParams(data, {
            ...currentParams,
            profitFraction: currentParams.profitFraction + epsilon
        });

        const profitDown = await calculateProfitForParams(data, {
            ...currentParams,
            profitFraction: Math.max(1.0001, currentParams.profitFraction - epsilon)
        });

        gradients.profitFraction = (profitUp - profitDown) / (2 * epsilon);

        // Calculate gradient for sellFraction
        const sellUp = await calculateProfitForParams(data, {
            ...currentParams,
            sellFraction: Math.min(1, currentParams.sellFraction + epsilon)
        });

        const sellDown = await calculateProfitForParams(data, {
            ...currentParams,
            sellFraction: Math.max(0.0001, currentParams.sellFraction - epsilon)
        });

        gradients.sellFraction = (sellUp - sellDown) / (2 * epsilon);

        // Normalize gradients
        const gradientNorm = Math.sqrt(
            gradients.dipFraction * gradients.dipFraction +
            gradients.profitFraction * gradients.profitFraction +
            gradients.sellFraction * gradients.sellFraction
        );

        // Avoid division by zero
        const normalizedGradients = gradientNorm > 1e-8 ? {
            dipFraction: gradients.dipFraction / gradientNorm,
            profitFraction: gradients.profitFraction / gradientNorm,
            sellFraction: gradients.sellFraction / gradientNorm
        } : gradients;

        // Update parameters using normalized gradients
        currentParams = {
            ...fixedParams,
            dipFraction: clamp(
                currentParams.dipFraction + learningRate * normalizedGradients.dipFraction,
                0.001,
                0.999
            ),
            profitFraction: clamp(
                currentParams.profitFraction + learningRate * normalizedGradients.profitFraction,
                1.001,
                2.0
            ),
            sellFraction: clamp(
                currentParams.sellFraction + learningRate * normalizedGradients.sellFraction,
                0.0001,
                1.0
            )
        };

        previousProfit = currentProfit;
        iteration++;

        // Log progress every 100 iterations
        if (iteration % Math.floor(maxIterations/10) === 0) {
            console.log(`Iteration ${iteration}: Profit = ${currentProfit}`);
            console.log(`Parameters: `, currentParams);
        }
    }

    return {
        ...bestParams,
        netProfitLoss: bestProfit,
        iterations: iteration
    };
}

// Helper function to calculate profit for given parameters
async function calculateProfitForParams(
    data: BTCData[],
    params: DipTradingParameters
): Promise<number> {
    try {
        const stats = await calculateProfitLoss(data, params);
        return stats.netProfitLoss;
    } catch (error) {
        return Number.NEGATIVE_INFINITY;
    }
}

// Helper function to clamp values between min and max
function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

// Example usage in main function
async function main() {
    const filename = "Poloniex_BTCUSDT_1h.csv";
    const data = await loadBtcData(filename);

    console.log("Starting parameter optimization...");

    const optimizedParams = await optimizeParameters(
        data,
        0.0001, // learningRate
        10000,   // maxIterations
        0.001   // convergenceThreshold
    );

    console.log("\nOptimization Results:");
    console.log(`Best Dip Fraction: ${optimizedParams.dipFraction.toFixed(4)}`);
    console.log(`Best Profit Fraction: ${optimizedParams.profitFraction.toFixed(4)}`);
    console.log(`Best Sell Fraction: ${optimizedParams.sellFraction.toFixed(4)}`);
    console.log(`Net Profit/Loss: $${optimizedParams.netProfitLoss.toLocaleString()}`);
    console.log(`Iterations: ${optimizedParams.iterations}`);

    // Run final simulation with optimized parameters

    const finalStats = await calculateProfitLoss(data, {...optimizedParams, ...fixedParams});

    console.log("\nFinal Trading Statistics:");
    console.log(`Total Trades: ${finalStats.purchases.length} buys, ${finalStats.sales.length} sells`);
    console.log(`Total Fees Paid: $${finalStats.totalFees.toLocaleString()}`);
    console.log(`Final Net Profit/Loss: $${finalStats.netProfitLoss.toLocaleString()}`);
}

main().catch(console.error);