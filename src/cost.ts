import { object } from "./gateway/people.js";

/** Provider usage normalized to the three API-price categories. */
export interface Tokens {
  input: number;
  output: number;
  cached: number;
}
export interface Usage {
  tokens: Tokens;
  reportedUsd?: number;
}
/** USD per million tokens, including subscription-backed deliveries. */
export type Price = Tokens;

/** Whole-request rates when prompt input (including cache reads/writes) exceeds minPrompt. */
export interface PriceTier extends Price {
  minPrompt: number;
}

/** A provider request, identified independently of repeated stream/poll deliveries. */
export interface CostRequest {
  id: string;
  tokens: Tokens;
  model?: string;
  /** Assistant creation time in epoch milliseconds, for model-switch attribution. */
  created?: number;
}

/** Persisted per-message prices; unchanged messages are never repriced on polling. */
export type RequestCosts = Record<string, { tokens: Tokens; usd: number | null }>;

/** Price requests separately and any unmeasured remainder at base rates (a lower bound). */
export function requestCost(
  total: Tokens,
  requests: readonly CostRequest[],
  rates: (request: CostRequest) => { price?: Price; tiers?: PriceTier[] },
  base: Price | undefined,
  cache: RequestCosts = {}
): { usd: number | null; lowerBound: boolean } {
  for (const request of requests) {
    const old = Object.hasOwn(cache, request.id) ? cache[request.id] : undefined;
    if (old && JSON.stringify(old.tokens) === JSON.stringify(request.tokens)) {
      continue;
    }
    const { price, tiers } = rates(request);
    Object.defineProperty(cache, request.id, {
      value: { tokens: request.tokens, usd: dollars(request.tokens, price, tiers) },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const entries = Object.values(cache);
  const measured = entries.reduce((sum, entry) => addTokens(sum, entry.tokens), zeroTokens());
  const remainder = usageDelta({ tokens: total }, { tokens: measured }).tokens;
  const lowerBound = !entries.length || Object.values(remainder).some((n) => n > 0);
  return {
    usd: sumUsd([
      ...entries.map((entry) => entry.usd),
      ...(lowerBound ? [dollars(remainder, base)] : []),
    ]),
    lowerBound,
  };
}

/** Decode token-bearing OpenCode messages as requests; anonymous legacy messages retain stable keys. */
export function opencodeRequests(messages: readonly unknown[]): CostRequest[] {
  return messages.flatMap((value) => {
    const message = object(value);
    const usage = opencodeUsage(message);
    const model = object(message.model);
    return usage
      ? [
          {
            id: typeof message.id === "string" ? message.id : JSON.stringify(message),
            tokens: usage.tokens,
            ...(typeof object(message.time).created === "number"
              ? { created: object(message.time).created as number }
              : {}),
            ...(model.providerID && model.id
              ? { model: `${String(model.providerID)}/${String(model.id)}` }
              : {}),
          },
        ]
      : [];
  });
}

export const zeroTokens = (): Tokens => ({ input: 0, output: 0, cached: 0 });

/** Add normalized counts without conflating cached input with uncached input. */
export function addTokens(a: Tokens, b: Tokens): Tokens {
  return { input: a.input + b.input, output: a.output + b.output, cached: a.cached + b.cached };
}

/** Subtract a model-switch baseline; a provider reset cannot become negative usage. */
export function usageDelta(total: Usage, baseline: Usage): Usage {
  const tokens = {
    input: total.tokens.input - baseline.tokens.input,
    output: total.tokens.output - baseline.tokens.output,
    cached: total.tokens.cached - baseline.tokens.cached,
  };
  if (Object.values(tokens).some((n) => n < 0)) {
    throw new Error("Provider usage decreased; cannot account for segment");
  }
  if (
    total.reportedUsd !== undefined &&
    baseline.reportedUsd !== undefined &&
    total.reportedUsd < baseline.reportedUsd
  ) {
    throw new Error("Provider reported cost decreased; cannot account for segment");
  }
  return {
    tokens,
    ...(total.reportedUsd === undefined || baseline.reportedUsd === undefined
      ? {}
      : { reportedUsd: total.reportedUsd - baseline.reportedUsd }),
  };
}

/** Calculate whole-request API USD using the highest exceeded prompt tier; missing data stays unknown. */
export function dollars(
  tokens: Tokens | undefined,
  price: Price | undefined,
  tiers: readonly PriceTier[] = []
): number | null {
  if (tokens && price) {
    price =
      tiers
        .filter((tier) => tokens.input + tokens.cached > tier.minPrompt)
        .sort((a, b) => b.minPrompt - a.minPrompt)[0] ?? price;
  }
  return tokens && price
    ? (tokens.input * price.input + tokens.output * price.output + tokens.cached * price.cached) /
        1_000_000
    : null;
}

/** Unknown measurements propagate rather than masquerading as free usage. */
export function sumUsd(values: readonly (number | null | undefined)[]): number | null {
  return values.some((value) => value == null)
    ? null
    : values.reduce<number>((sum, value) => sum + value!, 0);
}

/** Format known USD for the board's per-PR Cost, prefixing ≥ for totals-only/partial history. */
export function boardCost(usd: number | null, lowerBound = false): string | null {
  return usd === null ? null : `${lowerBound ? "≥ " : ""}$${usd.toFixed(2)}`;
}

/** Parse board Cost text, stripping a lower-bound marker; malformed values stay unknown. */
export function parseBoardCost(value: unknown): number | null {
  if (typeof value !== "string" || !/^(?:≥ )?\$\d+(?:\.\d{2})$/.test(value)) {
    return null;
  }
  const amount = Number(value.replace(/^≥ /, "").slice(1));
  return Number.isFinite(amount) ? amount : null;
}

/** Decode cumulative OpenCode totals, using full-history fallback only for absent categories. */
export function opencodeUsage(value: unknown, fallback?: Usage): Usage | undefined {
  const source = object(value);
  const tokens = object(source.tokens);
  const cache = object(tokens.cache);
  for (const value of [
    tokens.input,
    tokens.output,
    tokens.reasoning,
    cache.write,
    cache.read,
    source.cost,
  ]) {
    if (value !== undefined) {
      count(value);
    }
  }
  const input =
    tokens.input === undefined || cache.write === undefined
      ? fallback?.tokens.input
      : count(tokens.input) + count(cache.write);
  const output =
    tokens.output === undefined || tokens.reasoning === undefined
      ? fallback?.tokens.output
      : count(tokens.output) + count(tokens.reasoning);
  const cached = cache.read === undefined ? fallback?.tokens.cached : count(cache.read);
  if (input === undefined || output === undefined || cached === undefined) {
    return;
  }
  return {
    tokens: { input, output, cached },
    ...(source.cost === undefined
      ? fallback?.reportedUsd === undefined
        ? {}
        : { reportedUsd: fallback.reportedUsd }
      : { reportedUsd: count(source.cost) }),
  };
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Invalid provider usage count");
  }
  return value;
}
