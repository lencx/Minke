window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-conversation",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_slots = require("@deepseek-ai/dsh-client-ui-slots");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let _deepseek_ai_cordis = require("@deepseek-ai/cordis");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/types/client/stores.js
		/**
		* DetailsPanel patch preimage from the pinned Harness client bundle.
		*/
		function rawResultText(block) {
			if (!("kind" in block)) return "";
			const parts = block.content.map((item) => item.type === "text" ? item.text : JSON.stringify(item, null, 2));
			if (parts.length === 0 && block.error !== void 0) parts.push(`${block.error.name}: ${block.error.code}`);
			return parts.join("\n");
		}
		function DetailsPanel({ useSession, useSessions, sessionId, useStore, renderSlot, closeDetails, t }) {
			const selection = useStore((s) => s.selection);
			const sessionCwd = useSessions((list) => list.byId[sessionId]?.cwd);
			const callId = selection?.callId;
			const material = useSession((s) => callId === void 0 ? null : materialFor(s, callId), (a, b) => (0, _deepseek_ai_dsh_client_runtime_client.shallowEqual)(a, b));
			return (0, react_jsx_runtime.jsxs)("div", {
				className: DetailsPanel_module_css_default.root,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: DetailsPanel_module_css_default.header,
					children: [(0, react_jsx_runtime.jsx)("div", {
						className: DetailsPanel_module_css_default.title,
						children: selection === null ? t("details.title") : material?.name ?? selection.toolName ?? t("details.title")
					}), (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: DetailsPanel_module_css_default.close,
						"aria-label": t("details.close"),
						onClick: () => {
							closeDetails();
						},
						children: (0, react_jsx_runtime.jsx)("svg", {
							viewBox: "0 0 16 16",
							width: "14",
							height: "14",
							"aria-hidden": true,
							children: (0, react_jsx_runtime.jsx)("path", {
								d: "M4 4l8 8M12 4l-8 8",
								stroke: "currentColor",
								strokeWidth: "1.5",
								strokeLinecap: "round"
							})
						})
					})]
				}), (0, react_jsx_runtime.jsx)("div", {
					className: DetailsPanel_module_css_default.body,
					children: selection === null || callId === void 0 ? (0, react_jsx_runtime.jsx)("div", {
						className: DetailsPanel_module_css_default.empty,
						children: t("details.empty")
					}) : material === null ? (0, react_jsx_runtime.jsx)("div", {
						className: DetailsPanel_module_css_default.empty,
						children: t("details.notInWindow")
					}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [material.argsRaw !== null && (0, react_jsx_runtime.jsxs)("section", {
						className: DetailsPanel_module_css_default.section,
						children: [(0, react_jsx_runtime.jsx)("div", {
							className: DetailsPanel_module_css_default.sectionLabel,
							children: t("details.input")
						}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.CodeBlock, {
							code: pretty(material.argsRaw),
							lang: "json",
							copyLabel: t("copy"),
							copiedLabel: t("copied")
						})]
					}), (0, react_jsx_runtime.jsxs)("section", {
						className: DetailsPanel_module_css_default.section,
						children: [(0, react_jsx_runtime.jsx)("div", {
							className: DetailsPanel_module_css_default.sectionLabel,
							children: t("details.output")
						}), (0, react_jsx_runtime.jsx)(react.Fragment, { children: renderSlot("conversation.details.tool", {
							block: material.block,
							cwd: sessionCwd
						}, { fallback: "kind" in material.block ? (0, react_jsx_runtime.jsx)("pre", {
							className: DetailsPanel_module_css_default.code,
							"data-error": material.block.isError || void 0,
							children: rawResultText(material.block)
						}) : (0, react_jsx_runtime.jsx)("div", {
							className: DetailsPanel_module_css_default.empty,
							children: t("details.running")
						}) }) }, callId)]
					})] })
				})]
			});
		}
		//#endregion
		//#region lib/types/client/conversation-nodes/common.js
	}
});
