# Supplier debt tab in Debt Management

## Goal
Add a supplier-debt view to the existing debt-management page, alongside the current customer-debt view, without changing the existing customer workflow.

## Steps
1. Inspect the remaining `DebtManagement` component and its page styles to identify the customer table boundaries and navigation callback.
2. Add two tabs: customer debts and supplier debts. Keep current filters, cards, and table in the customer tab.
3. Build supplier rows from `crm_suppliers`, each supplier's `crm_supplier_orders_<id>`, and `crm_supplier_returns`. Calculate outstanding debt using the same order/return/legacy-debt rules as `SupplierDetail`.
4. In the supplier tab, show supplier debt totals and unpaid order counts, and make each row open the matching supplier profile.
5. Add responsive, namespaced styling and review the focused diff. Do not run tests/build unless requested.
