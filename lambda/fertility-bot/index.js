import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramApiUrl = process.env.TELEGRAM_API_URL ?? "https://api.telegram.org";
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const tableName = process.env.CYCLE_TABLE_NAME ?? "FertilityTrackerCycles";
const region = process.env.AWS_REGION ?? "us-east-1";

const dynamo = new DynamoDBClient({ region });

const TEXT = {
  welcome: `Hi! I'm your fertility tracker bot.
Send /log YYYY-MM-DD to record the first day of your cycle.
Send /stats to see your next expected period, ovulation, and fertile window.`,
  invalidLog: "Please provide a date in YYYY-MM-DD format, for example /log 2024-05-02.",
  stored: (date) => `Logged your cycle start on ${date}.`,
  noHistory: "I don't have enough history to make a prediction yet. Log at least one cycle start with /log YYYY-MM-DD.",
};

const dateOnly = (value) => value.toISOString().slice(0, 10);

const isValidDate = (value) => !Number.isNaN(value?.getTime?.());

const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));

async function sendTelegramMessage(chatId, text) {
  if (!botToken) {
    console.warn("Missing TELEGRAM_BOT_TOKEN; skipping Telegram call");
    return;
  }

  const url = `${telegramApiUrl}/bot${botToken}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function storeCycleStart(chatId, cycleStart) {
  const command = new PutItemCommand({
    TableName: tableName,
    Item: {
      chatId: { S: chatId },
      cycleStart: { S: cycleStart },
      createdAt: { S: new Date().toISOString() },
    },
  });

  await dynamo.send(command);
}

async function getCycleHistory(chatId) {
  const command = new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "chatId = :chatId",
    ExpressionAttributeValues: { ":chatId": { S: chatId } },
    ScanIndexForward: true,
  });

  const result = await dynamo.send(command);
  return (result.Items ?? []).map((item) => new Date(item.cycleStart.S)).sort((a, b) => a - b);
}

function buildPrediction(history) {
  if (history.length === 0) {
    return null;
  }

  const averageCycleLength = history.length > 1
    ? Math.round(
        history.slice(1).reduce((total, date, index) => total + daysBetween(history[index], date), 0) /
          (history.length - 1)
      )
    : 28;

  const lastStart = history[history.length - 1];
  const nextPeriod = new Date(lastStart);
  nextPeriod.setDate(nextPeriod.getDate() + averageCycleLength);

  const ovulation = new Date(lastStart);
  ovulation.setDate(ovulation.getDate() + averageCycleLength - 14);

  const fertileFrom = new Date(ovulation);
  fertileFrom.setDate(fertileFrom.getDate() - 5);

  const fertileTo = new Date(ovulation);
  fertileTo.setDate(fertileTo.getDate() + 1);

  return {
    averageCycleLength,
    lastStart: dateOnly(lastStart),
    nextPeriod: dateOnly(nextPeriod),
    ovulation: dateOnly(ovulation),
    fertileFrom: dateOnly(fertileFrom),
    fertileTo: dateOnly(fertileTo),
  };
}

function unauthorizedResponse() {
  return { statusCode: 401, body: "invalid secret" };
}

function okResponse() {
  return { statusCode: 200, body: "ok" };
}

export const handler = async (event) => {
  if (webhookSecret) {
    const provided = event.headers?.["x-telegram-bot-api-secret-token"] ?? event.headers?.["X-Telegram-Bot-Api-Secret-Token"];
    if (provided !== webhookSecret) {
      return unauthorizedResponse();
    }
  }

  const body = event.body ? JSON.parse(event.body) : {};
  const message = body.message ?? body.edited_message;

  const text = message?.text?.trim();
  const chatId = message?.chat?.id;

  if (!text || !chatId) {
    return okResponse();
  }

  if (text.startsWith("/start")) {
    await sendTelegramMessage(chatId, TEXT.welcome);
    return okResponse();
  }

  if (text.startsWith("/log")) {
    const [, dateInput] = text.split(/\s+/, 2);
    const parsedDate = new Date(`${dateInput}T00:00:00Z`);

    if (!dateInput || !isValidDate(parsedDate)) {
      await sendTelegramMessage(chatId, TEXT.invalidLog);
      return okResponse();
    }

    const value = dateOnly(parsedDate);
    await storeCycleStart(String(chatId), value);
    await sendTelegramMessage(chatId, TEXT.stored(value));
    return okResponse();
  }

  if (text.startsWith("/stats")) {
    const history = await getCycleHistory(String(chatId));
    const prediction = buildPrediction(history);

    if (!prediction) {
      await sendTelegramMessage(chatId, TEXT.noHistory);
      return okResponse();
    }

    const summary = [
      `Last logged start: ${prediction.lastStart}`,
      `Avg cycle length: ${prediction.averageCycleLength} days`,
      `Next period: ${prediction.nextPeriod}`,
      `Ovulation: ${prediction.ovulation}`,
      `Fertile window: ${prediction.fertileFrom} → ${prediction.fertileTo}`,
    ].join("\n");

    await sendTelegramMessage(chatId, summary);
    return okResponse();
  }

  await sendTelegramMessage(chatId, "I can log your cycle with /log YYYY-MM-DD and show insights with /stats.");
  return okResponse();
};
