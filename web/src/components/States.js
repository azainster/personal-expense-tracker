import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function LoadingCard({ lines = 3, height = 14 }) {
    return (_jsxs("div", { className: "vstack", "aria-busy": "true", "aria-live": "polite", children: [_jsx("span", { className: "visually-hidden", children: "Loading\u2026" }), Array.from({ length: lines }, (_, i) => (_jsx("div", { className: "skeleton", style: { height, width: `${100 - i * 12}%` } }, i)))] }));
}
export function DashboardSkeleton() {
    return (_jsxs("div", { className: "grid", "aria-busy": "true", children: [_jsx("span", { className: "visually-hidden", children: "Loading dashboard\u2026" }), _jsx("div", { className: "grid grid-stats", children: Array.from({ length: 4 }, (_, i) => (_jsxs("div", { className: "card", children: [_jsx("div", { className: "skeleton", style: { height: 12, width: '55%', marginBottom: 12 } }), _jsx("div", { className: "skeleton", style: { height: 28, width: '75%' } })] }, i))) }), _jsxs("div", { className: "grid grid-charts", children: [_jsx("div", { className: "card", children: _jsx("div", { className: "skeleton", style: { height: 220 } }) }), _jsx("div", { className: "card", children: _jsx("div", { className: "skeleton", style: { height: 220 } }) })] })] }));
}
export function EmptyState({ title, message, actions, }) {
    return (_jsxs("div", { className: "state", children: [_jsx("h3", { children: title }), _jsx("p", { children: message }), actions && _jsx("div", { className: "state-actions", children: actions })] }));
}
export function ErrorState({ title = 'Something went wrong', message, onRetry, }) {
    return (_jsxs("div", { className: "state", role: "alert", children: [_jsx("h3", { children: title }), _jsx("p", { children: message }), onRetry && (_jsx("div", { className: "state-actions", children: _jsx("button", { className: "btn", onClick: onRetry, children: "Try again" }) }))] }));
}
export function Banner({ kind = 'info', children, onDismiss, }) {
    return (_jsxs("div", { className: `banner banner-${kind}`, role: kind === 'error' ? 'alert' : 'status', children: [_jsx("div", { children: children }), onDismiss && (_jsx("button", { className: "btn btn-sm", onClick: onDismiss, "aria-label": "Dismiss", children: "\u2715" }))] }));
}
