import { jsx as _jsx } from "react/jsx-runtime";
export function Tooltip({ state }) {
    if (!state)
        return null;
    return (_jsx("div", { className: "tooltip", style: { left: state.x, top: state.y - 8 }, role: "tooltip", children: state.content }));
}
