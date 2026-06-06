function safeParseJSON(value, fallback = null) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '[object Object]' || trimmed === 'undefined' || trimmed === 'null') {
      return fallback;
    }
    try {
      return safeParseJSON(trimmed, {});  // BUG: no JSON.parse!
    } catch (e) {
      return fallback;
    }
  }
  return fallback;
}

const result = { tables: [1,2,3] };
const str = JSON.stringify(result, {});
console.log('Stringify:', str);
const parsed = safeParseJSON(str);
console.log('Parsed:', parsed);
