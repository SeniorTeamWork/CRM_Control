import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Login from "./Login";
jest.mock("../data/accessStore", () => ({ getDirector: () => ({}), readLocalLogin: () => ({ login: "test", password: "test-password" }), authenticate: () => new Promise(() => {}), registerDirector: jest.fn() }));
jest.mock("../data/tenantBrand", () => ({ useTenantCompanyName: () => "CRM" }));
jest.mock("../data/loginThrottle", () => ({ LOGIN_SCOPES: { crm: "crm" }, useLoginLock: () => ({ locked: false, refresh() {} }) }));
jest.mock("./PasswordRecovery", () => () => null);
test("translated login button can enter loading state", async () => {
 global.IS_REACT_ACT_ENVIRONMENT = true;
 const host = document.createElement("div"); document.body.appendChild(host);
 const errors = []; const root = createRoot(host, { onUncaughtError: error => errors.push(error) });
 try {
 await act(async () => root.render(<Login onLogin={() => {}}/>));
 const button = host.querySelector('button[type="submit"]');
 const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
 const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
 texts.filter(node => node.textContent.trim()).forEach(node => { const font = document.createElement("font"); font.textContent = "Login"; node.parentNode.replaceChild(font, node); });
 await act(async () => host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
 expect(errors).toEqual([]);
 expect(host.querySelector('button[type="submit"]').disabled).toBe(true);
 } finally { await act(async () => root.unmount()); host.remove(); }
});
