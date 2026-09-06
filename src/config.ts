import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  DATA_DIR: z.string().min(1).default("data"),
  OPENROUTER_API_KEY: z.string().trim().min(1).optional(),
  BRAVE_SEARCH_API_KEY: z.string().trim().min(1).optional(),
  DOCKER_SOCKET: z.string().min(1).default("/var/run/docker.sock"),
  WORKER_IMAGE: z.string().min(1).default("alpine:3.22.5"),
});

export const config = envSchema.parse(process.env);

export type Config = typeof config;
