const EXPONENTS = { JPY: 0, KRW: 0, VND: 0, KWD: 3, BHD: 3, OMR: 3 };
export function exponentFor(currency) {
    return EXPONENTS[currency.toUpperCase()] ?? 2;
}
/** Money is stored as integer minor units; only display converts. */
export function formatMoney(minorUnits, currency, options = {}) {
    const exponent = exponentFor(currency);
    const value = minorUnits / 10 ** exponent;
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
            minimumFractionDigits: options.compact ? 0 : exponent,
            maximumFractionDigits: options.compact ? 0 : exponent,
            notation: options.compact && Math.abs(value) >= 100_000 ? 'compact' : 'standard',
        }).format(value);
    }
    catch {
        return `${currency} ${value.toFixed(exponent)}`;
    }
}
export function formatDate(iso, style = 'short') {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return iso;
    return date.toLocaleDateString(undefined, style === 'short'
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function formatMonth(month) {
    const [year, m] = month.split('-');
    const date = new Date(Number(year), Number(m) - 1, 1);
    if (Number.isNaN(date.getTime()))
        return month;
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
export function formatPercent(share) {
    return `${(share * 100).toFixed(share < 0.01 && share > 0 ? 1 : 0)}%`;
}
export function relativeTime(iso) {
    if (!iso)
        return 'never';
    const then = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`).getTime();
    if (Number.isNaN(then))
        return iso;
    const seconds = Math.round((Date.now() - then) / 1000);
    if (seconds < 60)
        return 'just now';
    if (seconds < 3600)
        return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400)
        return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}
