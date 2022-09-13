import { createLogger, format, Logger, transports } from 'winston';
const { combine, printf, timestamp, align, colorize } = format;
import * as path from 'path';
import { g } from './utils.js';
import type * as Transport from 'winston-transport';

export function getConsoleLogger(module: string, console = true): Logger {
  const transportsConfig = [
    new transports.File({
      filename: path.join(g.LOG_DIR, `crawler.log`),
      options: { flags: 'w' },
    }),
  ] as Transport[];
  if (console) {
    transportsConfig.push(new transports.Console());
  }
  return createLogger({
    level: 'debug',
    format: combine(
      colorize(),
      timestamp(),
      align(),
      printf(({ message, level, timestamp }) => {
        return `${timestamp}::${module}::${level}: ${message}`;
      })
    ),
    transports: transportsConfig,
  });
}
