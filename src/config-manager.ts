import * as path from "node:path";

import type config from "#config";

type Config = typeof config;

const CONFIG_PATH = path.join(process.cwd(), "config.json");

export async function loadConfig(): Promise<Config> {
  const config: Config = await Bun.file(CONFIG_PATH).json();
  return config;
}

export async function updateConfig(config: Config): Promise<void> {
  const content = JSON.stringify(config, null, 2);
  await Bun.write(CONFIG_PATH, `${content}\n`);
}
