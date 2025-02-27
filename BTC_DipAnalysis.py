import csv
from dataclasses import dataclass
from datetime import datetime
from typing import List


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


def analyze_dips_and_buy(data: List[BTCData], dip_fraction: float, dollar_amount: float) -> List[dict]:
    if not 0 < dip_fraction < 1:
        raise ValueError("Dip fraction must be between 0 and 1")

    purchases = []
    all_time_high = 0.0
    allow_purchase = False

    for row in data:
        # Update all-time high if we see a new one
        if row.high > all_time_high:
            all_time_high = row.high
            allow_purchase = True

        # Check if price has dipped enough from ATH to trigger a purchase
        dip_target = all_time_high * dip_fraction
        if allow_purchase == True and row.low <= dip_target:
            # Calculate how much BTC we can buy with our dollar amount
            btc_amount = dollar_amount / row.low
            purchases.append({
                'date': row.date,
                'price': row.low,
                'all_time_high': all_time_high,
                'btc_purchased': btc_amount,
                'dollars_spent': dollar_amount
            })
            allow_purchase = False

    return purchases


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
    dip_fraction = 0.975  # Buy when price dips to 90% of ATH
    dollar_amount = 1000  # Spend $1000 on each dip

    try:
        data = load_btc_data(filename)
        purchases = analyze_dips_and_buy(data, dip_fraction, dollar_amount)

        # Print results
        total_btc = sum(p['btc_purchased'] for p in purchases)
        total_spent = sum(p['dollars_spent'] for p in purchases)

        print(f"\nTotal purchases made: {len(purchases)}")
        print(f"Total BTC acquired: {total_btc:.8f}")
        print(f"Total USD spent: ${total_spent:,.2f}")

        # Print individual purchases
        print("\nPurchase history:")
        for purchase in purchases:
            print(f"Date: {purchase['date']}, "
                  f"Price: ${purchase['price']:,.2f}, "
                  f"BTC bought: {purchase['btc_purchased']:.8f}")

    except FileNotFoundError:
        print(f"Error: Could not find file {filename}")
    except Exception as e:
        print(f"An error occurred: {str(e)}")


if __name__ == "__main__":
    main()