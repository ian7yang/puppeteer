import {createLogger, format, transports} from 'winston';
const {combine, printf, timestamp, align, colorize} = format;
import * as path from 'path';
import {g} from './utils'

export function getConsoleLogger(module: string, console = true) {
  const transportsConfig = [
    new transports.File({
      filename: path.join(g.LOG_DIR, `crawler.log`), options: {flags: 'w'},
    })];
  if (console) {
    //@ts-ignore
    transportsConfig.push(new transports.Console());
  }
  return createLogger({
    level: 'debug',
    format: combine(colorize(), timestamp(), align(), printf(({
                                                                message,
                                                                level,
                                                                timestamp,
                                                              }) => `${timestamp}::${module}::${level}: ${message}`)),
    transports: transportsConfig,
  });
}
