import csv
import math
from dataclasses import dataclass
from datetime import datetime
from typing import List, Tuple


@dataclass
class BTCData:
    unix_time: int
    date: datetime
    symbol: str
    open_price: float
    high: float
    low: float
    close: float
    volume_btc: float
    volume_usdt: float
    buy_taker_amount: float
    buy_taker_quantity: float
    trade_count: int
    weighted_average: float

    @classmethod
    def from_csv_row(cls, row: dict) -> 'BTCData':
        return cls(
            unix_time=int(row['unix']),
            date=datetime.strptime(row['date'], '%Y-%m-%d %H:%M:%S'),
            symbol=row['symbol'],
            open_price=float(row['open']),
            high=float(row['high']),
            low=float(row['low']),
            close=float(row['close']),
            volume_btc=float(row['Volume BTC']),
            volume_usdt=float(row['Volume USDT']),
            buy_taker_amount=float(row['buyTakerAmount']),
            buy_taker_quantity=float(row['buyTakerQuantity']),
            trade_count=int(row['tradeCount']),
            weighted_average=float(row['weightedAverage'])
        )


def analyze_dips_and_trade(data: List[BTCData], dip_fraction: float, profit_fraction: float,
                           dollar_amount: float, sell_fraction: float) -> Tuple[List[dict], List[dict]]:
    if not 0 < dip_fraction < 1:
        raise ValueError("Dip fraction must be between 0 and 1")
    if profit_fraction <= 1:
        raise ValueError("Profit fraction must be greater than 1")
    if not 0 < sell_fraction <= 1:
        raise ValueError("Sell fraction must be between 0 and 1")

    purchases = []
    sales = []
    all_time_high = 0.0
    current_btc_holdings = 0.0
    sell_target = 0.0
    allow_purchase = False
    ready_to_sell = False

    for row in data:
        # Update all-time high if we see a new one
        if row.high > all_time_high:
            all_time_high = row.high
            allow_purchase = True

        # Check for selling conditions first
        if ready_to_sell and current_btc_holdings > 0:
            if row.high >= sell_target:
                # Sell specified fraction of current BTC holdings
                btc_to_sell = current_btc_holdings * sell_fraction
                dollars_received = btc_to_sell * row.high
                sales.append({
                    'date': row.date,
                    'price': row.high,
                    'all_time_high': all_time_high,
                    'btc_sold': btc_to_sell,
                    'dollars_received': dollars_received,
                    'btc_remaining': current_btc_holdings - btc_to_sell
                })
                current_btc_holdings -= btc_to_sell
                ready_to_sell = False
                allow_purchase = True  # Allow new purchase after selling

        # Check for buying conditions
        dip_target = all_time_high * dip_fraction
        if allow_purchase and row.low <= dip_target:
            # Calculate how much BTC we can buy with our dollar amount
            purchase_amount = dollar_amount * math.log2(len(sales) + 2)
            print(purchase_amount)
            btc_amount = purchase_amount / row.low
            purchases.append({
                'date': row.date,
                'price': row.low,
                'all_time_high': all_time_high,
                'btc_purchased': btc_amount,
                'dollars_spent': dollar_amount,
                'total_btc_after_purchase': current_btc_holdings + btc_amount
            })
            current_btc_holdings += btc_amount
            allow_purchase = False
            ready_to_sell = True  # Enable selling after purchase
            sell_target = all_time_high * profit_fraction

    return purchases, sales


def load_btc_data(filename: str) -> List[BTCData]:
    data = []
    with open(filename, 'r') as file:
        csv_reader = csv.DictReader(file)
        for row in csv_reader:
            data.append(BTCData.from_csv_row(row))
    return data


def main():
    # Example usage
    filename = "Poloniex_BTCUSDT_1h.csv"
    dip_fraction = 0.98  # Buy when price dips to this fraction of ATH
    profit_fraction = 1.01  # Sell when price exceeds ATH by this fraction
    dollar_amount = 1000  # Spend $amount on each dip
    sell_fraction = 0.10  # Sell this fraction of holdings each time
    print_transactions = False

    try:
        data = load_btc_data(filename)
        purchases, sales = analyze_dips_and_trade(data, dip_fraction, profit_fraction,
                                                  dollar_amount, sell_fraction)

        # Print purchase results
        total_btc_bought = sum(p['btc_purchased'] for p in purchases)
        total_spent = sum(p['dollars_spent'] for p in purchases)

        print(f"\nTotal purchases made: {len(purchases)}")
        print(f"Total BTC bought: {total_btc_bought:.8f}")
        print(f"Total USD spent: ${total_spent:,.2f}")

        # Print sale results
        total_btc_sold = sum(s['btc_sold'] for s in sales)
        total_received = sum(s['dollars_received'] for s in sales)

        print(f"\nTotal sales made: {len(sales)}")
        print(f"Total BTC sold: {total_btc_sold:.8f}")
        print(f"Total USD received: ${total_received:,.2f}")
        print(f"Net profit/loss: ${total_received - total_spent:,.2f}")

        # Calculate remaining BTC holdings
        final_btc_holdings = total_btc_bought - total_btc_sold
        print(f"Remaining BTC holdings: {final_btc_holdings:.8f}")

        # Print detailed trading history
        if print_transactions:
            print("\nTrading history:")
            print("\nPurchases:")
            for purchase in purchases:
                print(f"BUY  - Date: {purchase['date']}, "
                      f"Price: ${purchase['price']:,.2f}, "
                      f"BTC: {purchase['btc_purchased']:.8f}, "
                      f"Total BTC: {purchase['total_btc_after_purchase']:.8f}")

            print("\nSales:")
            for sale in sales:
                print(f"SELL - Date: {sale['date']}, "
                      f"Price: ${sale['price']:,.2f}, "
                      f"BTC Sold: {sale['btc_sold']:.8f}, "
                      f"BTC Remaining: {sale['btc_remaining']:.8f}")

    except FileNotFoundError:
        print(f"Error: Could not find file {filename}")
    except Exception as e:
        print(f"An error occurred: {str(e)}")


if __name__ == "__main__":
    main()
