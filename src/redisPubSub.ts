import Redis from "ioredis";

export const subscriber = new Redis({
	port: 6379,
	host: process.env.ENV_ID === "prod" ? "127.0.0.1" : "redis",
	username: "default",
	password: "pass",
	showFriendlyErrorStack: true,
	db: 0,

	enableReadyCheck: true,
	autoResubscribe: true,
	retryStrategy: (times) => {
		return Math.min(times * 500, 5000);
	},
});

export const publisher = new Redis({
	port: 6379,
	host: process.env.ENV_ID === "prod" ? "127.0.0.1" : "redis",
	username: "default",
	password: "pass",
	showFriendlyErrorStack: true,
	db: 0,

	enableReadyCheck: true,
	autoResubscribe: true,
	retryStrategy: (times) => {
		return Math.min(times * 500, 5000);
	},
})

export function generateChannelName(uid, ...keys) {
	return `${uid}.${keys.join('.')}`
}