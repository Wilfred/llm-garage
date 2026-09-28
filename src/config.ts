import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  DATA_DIR: z.string().min(1).default("data"),
  OPENROUTER_API_KEY: z.string().trim().min(1).optional(),
  BRAVE_SEARCH_API_KEY: z.string().trim().min(1).optional(),
  GITHUB_TOKEN: z.string().trim().min(1).optional(),
  AUTH_SECRET: z.string().trim().min(1).optional(),
  AUTH_GITHUB_ID: z.string().trim().min(1).optional(),
  AUTH_GITHUB_SECRET: z.string().trim().min(1).optional(),
  AUTH_GITHUB_USERS: z
    .string()
    .trim()
    .min(1)
    .transform((users) => users.split(",").map((user) => user.trim()))
    .optional(),
  DOCKER_SOCKET: z.string().min(1).default("/var/run/docker.sock"),
  WORKER_IMAGE: z.string().min(1).default("ghcr.io/wilfred/llm-garage:worker"),
  MAX_RUNNING_TRAJECTORIES: z.coerce.number().int().positive().default(2),
  COMMAND_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(900),
});

export const config = envSchema.parse(process.env);

export type Config = typeof config;
