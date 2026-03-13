# Fertility tracker Telegram bot (AWS Lambda)

This mini app adds a Telegram webhook handler that records cycle starts and reports a predicted ovulation and fertile window. It is shipped as an independent Lambda function under `lambda/fertility-bot`.

## Features

- `/start` — send onboarding help.
- `/log YYYY-MM-DD` — store the first day of a cycle in DynamoDB.
- `/stats` — calculate an average cycle length and report the next period, ovulation, and fertile window.
- Optional webhook secret validation via the `X-Telegram-Bot-Api-Secret-Token` header.

## Deployment

1. Create a DynamoDB table (for example `FertilityTrackerCycles`) with the following keys:
   - Partition key: `chatId` (String)
   - Sort key: `cycleStart` (String, `YYYY-MM-DD`)
2. Deploy the Lambda with a Node.js 18 runtime and the code from `lambda/fertility-bot/index.js`.
3. Install dependencies inside `lambda/fertility-bot` and bundle them with the deployment artifact:

   ```bash
   cd lambda/fertility-bot
   npm install
   zip -r fertility-bot.zip .
   ```

4. Set these environment variables on the function:
   - `TELEGRAM_BOT_TOKEN`: Telegram bot token
   - `CYCLE_TABLE_NAME`: DynamoDB table name (defaults to `FertilityTrackerCycles`)
   - `TELEGRAM_WEBHOOK_SECRET`: optional secret to match `X-Telegram-Bot-Api-Secret-Token`
   - `TELEGRAM_API_URL`: override if using a self-hosted Telegram gateway
   - `AWS_REGION`: AWS region for the DynamoDB client
5. Expose the Lambda through API Gateway (HTTP API). Configure the Telegram webhook to call that endpoint and include the same webhook secret if you set one:

   ```bash
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url="https://<api-id>.execute-api.<region>.amazonaws.com/telegram" \
     -d secret_token="$TELEGRAM_WEBHOOK_SECRET"
   ```

The handler will respond with a simple `ok` to Telegram and post the results back to the chat via `sendMessage`.
