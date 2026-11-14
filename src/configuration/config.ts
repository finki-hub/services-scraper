import { readFileSync } from 'node:fs';
import { ZodError } from 'zod';

import { type ConfigKeys, ConfigSchema } from '../lib/Config.js';
import { ERROR_MESSAGES } from '../utils/constants.js';
import { DEFAULT_CONFIGURATION } from './defaults.js';

const describeConfigError = (error: unknown): string => {
  if (!(error instanceof ZodError)) {
    return ERROR_MESSAGES.configParseFailed;
  }

  // Include schema paths and messages so a bad configuration is actionable at
  // startup. Never include issue inputs, which may hold credentials.
  const details = error.issues
    .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
    .join('; ');

  return `${ERROR_MESSAGES.configParseFailed}: ${details}`;
};

const initializeConfig = () => {
  try {
    const contents = readFileSync('./config/config.json', 'utf8');
    const parsedContents: unknown = JSON.parse(contents);

    return ConfigSchema.parse(parsedContents);
  } catch (error) {
    throw new Error(describeConfigError(error), {
      cause: error,
    });
  }
};

const config = initializeConfig();

export const getConfigProperty = <T extends ConfigKeys>(property: T) =>
  config?.[property] ?? DEFAULT_CONFIGURATION[property];
