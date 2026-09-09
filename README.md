# PumpFinder V5

PumpFinder V5 uses the free PumpDev WebSocket as its Pump.fun data source. PumpDev documents a free real-time WebSocket with no API key required for anonymous use, with 5 simultaneous subscriptions and 10,000 trade messages/month; a free account raises this to 25 subscriptions and 50,000 trades/month.

This version is alert/analytics only. It does not hold a wallet, private key, or execute trades.

## Railway

Variables:
- CAPITAL_EUR=20
- MIN_SCORE=85
- MAX_CANDIDATES=20
- MAX_TOKEN_SUBSCRIPTIONS=4
- TELEGRAM_BOT_TOKEN=optional
- TELEGRAM_CHAT_ID=optional

No Bitquery token is required.

## Important limitation

The free anonymous PumpDev feed allows 5 subscriptions. PumpFinder reserves one for new-token launches and uses up to 4 token-trade subscriptions. A free PumpDev account provides higher limits. This is a free monitoring version, not an exhaustive all-token market scanner.
