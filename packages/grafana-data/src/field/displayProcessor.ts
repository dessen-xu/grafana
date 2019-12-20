// Libraries
import _ from 'lodash';

// Types
import { Field, FieldType } from '../types/dataFrame';
import { GrafanaTheme } from '../types/theme';
import { DisplayProcessor, DisplayValue, DecimalCount, DecimalInfo } from '../types/displayValue';
import { getValueFormat } from '../valueFormats/valueFormats';
import { getMappedValue } from '../utils/valueMappings';
import { DEFAULT_DATE_TIME_FORMAT } from '../datetime';
import { KeyValue } from '../types';
import { getScaleCalculator } from '../utils';

interface DisplayProcessorOptions {
  field: Partial<Field>;

  // Context
  isUtc?: boolean;
  theme?: GrafanaTheme; // Will pick 'dark' if not defined
}

// Reasonable units for time
const timeFormats: KeyValue<boolean> = {
  dateTimeAsIso: true,
  dateTimeAsUS: true,
  dateTimeFromNow: true,
};

export function getDisplayProcessor(options?: DisplayProcessorOptions): DisplayProcessor {
  if (!options || _.isEmpty(options) || !options.field) {
    return toStringProcessor;
  }
  const { field } = options;
  const config = field.config ?? {};

  if (field.type === FieldType.time) {
    if (config.unit && timeFormats[config.unit]) {
      // Currently selected unit is valid for time fields
    } else if (config.unit && config.unit.startsWith('time:')) {
      // Also OK
    } else {
      config.unit = `time:${DEFAULT_DATE_TIME_FORMAT}`;
    }
  }

  const formatFunc = getValueFormat(config.unit || 'none');
  const scaleFunc = getScaleCalculator(field as Field, options.theme);

  return (value: any) => {
    const { mappings } = config;

    let text = _.toString(value);
    let numeric = toNumber(value);
    let prefix: string | undefined = undefined;
    let suffix: string | undefined = undefined;

    let shouldFormat = true;
    if (mappings && mappings.length > 0) {
      const mappedValue = getMappedValue(mappings, value);

      if (mappedValue) {
        text = mappedValue.text;
        const v = toNumber(text);

        if (!isNaN(v)) {
          numeric = v;
        }

        shouldFormat = false;
      }
    }

    if (!isNaN(numeric)) {
      if (shouldFormat && !_.isBoolean(value)) {
        const { decimals, scaledDecimals } = getDecimalsForValue(value, config.decimals);
        const v = formatFunc(numeric, decimals, scaledDecimals, options.isUtc);
        text = v.text;
        suffix = v.suffix;
        prefix = v.prefix;

        // Check if the formatted text mapped to a different value
        if (mappings && mappings.length > 0) {
          const mappedValue = getMappedValue(mappings, text);
          if (mappedValue) {
            text = mappedValue.text;
          }
        }
      }

      // Return the value along with scale info
      if (text) {
        return { text, numeric, prefix, suffix, ...scaleFunc(numeric) };
      }
    }

    if (!text) {
      if (config.noValue) {
        text = config.noValue;
      } else {
        text = ''; // No data?
      }
    }
    return { text, numeric, prefix, suffix };
  };
}

/** Will return any value as a number or NaN */
function toNumber(value: any): number {
  if (typeof value === 'number') {
    return value;
  }
  if (value === '' || value === null || value === undefined || Array.isArray(value)) {
    return NaN; // lodash calls them 0
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return _.toNumber(value);
}

function toStringProcessor(value: any): DisplayValue {
  return { text: _.toString(value), numeric: toNumber(value) };
}

// function getSignificantDigitCount(n: number): number {
//   // remove decimal and make positive
//   n = Math.abs(parseInt(String(n).replace('.', ''), 10));
//   if (n === 0) {
//     return 0;
//   }
//
//   // kill the 0s at the end of n
//   while (n !== 0 && n % 10 === 0) {
//     n /= 10;
//   }
//
//   // get number of digits
//   return Math.floor(Math.log(n) / Math.LN10) + 1;
// }

export function getDecimalsForValue(value: number, decimalOverride?: DecimalCount): DecimalInfo {
  if (_.isNumber(decimalOverride)) {
    // It's important that scaledDecimals is null here
    return { decimals: decimalOverride, scaledDecimals: null };
  }

  let dec = -Math.floor(Math.log(value) / Math.LN10) + 1;
  const magn = Math.pow(10, -dec);
  const norm = value / magn; // norm is between 1.0 and 10.0
  let size;

  if (norm < 1.5) {
    size = 1;
  } else if (norm < 3) {
    size = 2;
    // special case for 2.5, requires an extra decimal
    if (norm > 2.25) {
      size = 2.5;
      ++dec;
    }
  } else if (norm < 7.5) {
    size = 5;
  } else {
    size = 10;
  }

  size *= magn;

  // reduce starting decimals if not needed
  if (value % 1 === 0) {
    dec = 0;
  }

  const decimals = Math.max(0, dec);
  const scaledDecimals = decimals - Math.floor(Math.log(size) / Math.LN10) + 2;

  return { decimals, scaledDecimals };
}
