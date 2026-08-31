"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { type AdminDashboardUser } from "@/lib/adminUsers";
import { createTranslator, resultCount } from "@/lib/i18n";
import { paginateItems, paginationRangeLabel, TABLE_PAGE_SIZE } from "@/lib/pagination";
import { canManageAdminUsers, canSuspendUserAccounts, USER_ROLES } from "@/lib/roles";
import { matchesSearch } from "@/lib/tableSearch";
import { useModal } from "@/lib/useModal";
import type { FiscalixUser } from "@/models/User";

type UserMutationAction = "activate" | "assign_admin" | "delete" | "revoke_admin" | "suspend";
type PendingUserAction = { action: UserMutationAction; user: AdminDashboardUser };

function formatDate(value: string | null, language = "es") {
  if (!value) return "—";
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatMoney(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("es-MX", {
    currency: "MXN",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function fullName(user: Pick<AdminDashboardUser, "apellido" | "nombre">) {
  return `${user.nombre} ${user.apellido ?? ""}`.trim();
}

function billingStatusClass(status: string) {
  if (status === "pago_no_acreditado") return "admin-billing-status danger";
  if (status === "pagado_exito_mes") return "admin-billing-status success";
  if (status === "revision_manual") return "admin-billing-status warning";
  return "admin-billing-status";
}

export function AdminUsersDashboard({
  currentUser,
  users,
}: {
  currentUser: FiscalixUser;
  users: AdminDashboardUser[];
}) {
  const language = currentUser.preferences?.language ?? "es";
  const t = createTranslator(language);
  const [message, setMessage] = useState("");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState("");
  const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState<PendingUserAction | null>(null);
  const [query, setQuery] = useState("");
  const confirmationDialogRef = useRef<HTMLElement>(null);
  const canDelete = canManageAdminUsers(currentUser);
  const canSuspend = canSuspendUserAccounts(currentUser);
  const canShowActions = canDelete || canSuspend;
  const billingLabels = useMemo(() => ({
    pago_no_acreditado: createTranslator(language)("billing.pago_no_acreditado"),
    pagado_exito_mes: createTranslator(language)("billing.pagado_exito_mes"),
    proxima_a_pagar: createTranslator(language)("billing.proxima_a_pagar"),
    revision_manual: createTranslator(language)("billing.revision_manual"),
  }) as const, [language]);
  const billingLabel = useCallback(
    (status: string, fallback: string) => billingLabels[status as keyof typeof billingLabels] ?? fallback,
    [billingLabels],
  );
  const filteredUsers = useMemo(() => users.filter((user) => matchesSearch([
    fullName(user),
    user.correo,
    user.telefono,
    user.rolLabel,
    user.companyName,
    user.planName,
    billingLabel(user.billingStatus, user.billingStatusLabel),
    formatMoney(user.billingAmount),
    user.estado,
    formatDate(user.nextBillingDate, language),
    formatDate(user.fechaRegistro, language),
  ], query)), [billingLabel, language, query, users]);
  const usersPage = useMemo(() => paginateItems(filteredUsers, page, TABLE_PAGE_SIZE), [filteredUsers, page]);

  const closeConfirmationModal = useCallback(() => {
    if (busyUserId) return;
    setConfirmationError("");
    setPendingAction(null);
  }, [busyUserId]);
  useModal({ busy: Boolean(busyUserId), dialogRef: confirmationDialogRef, onClose: closeConfirmationModal, open: Boolean(pendingAction) });

  const stats = useMemo(() => {
    const active = users.filter((user) => user.estado === "activo").length;
    const activeSubscriptions = users.filter((user) => user.subscriptionStatus === "activa").length;
    const billingAttention = users.filter((user) => user.billingStatus === "pago_no_acreditado" || user.billingStatus === "revision_manual").length;
    const clients = users.filter((user) => user.rol === "cliente_fiscalix").length;
    const paidThisMonth = users.filter((user) => user.billingStatus === "pagado_exito_mes").length;
    const suspended = users.filter((user) => user.estado === "suspendido").length;
    return { active, activeSubscriptions, billingAttention, clients, paidThisMonth, suspended, total: users.length };
  }, [users]);

  function requestUserMutation(user: AdminDashboardUser, action: UserMutationAction) {
    if (action === "delete" && !canDelete) return;
    if (action !== "delete" && !canSuspend) return;
    if ((action === "assign_admin" || action === "revoke_admin") && !canDelete) return;

    setConfirmationError("");
    setPendingAction({ action, user });
  }

  async function mutateUser() {
    if (!pendingAction) return;
    const { action, user } = pendingAction;

    setBusyUserId(user.id);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        body: action === "delete" ? undefined : JSON.stringify({ action }),
        headers: action === "delete" ? undefined : { "Content-Type": "application/json" },
        method: action === "delete" ? "DELETE" : "PATCH",
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? t("admin.actionError"));

      setMessage(result.message ?? t("admin.actionDone"));
      window.location.reload();
    } catch (error) {
      setConfirmationError(error instanceof Error ? error.message : t("admin.actionError"));
    } finally {
      setBusyUserId(null);
    }
  }

  const pendingActionLabel = pendingAction?.action === "delete"
    ? t("admin.deleteAction")
    : pendingAction?.action === "suspend"
      ? t("admin.suspendAction")
      : pendingAction?.action === "activate"
        ? t("admin.activateAction")
        : pendingAction?.action === "assign_admin"
          ? "designar como administrador"
          : "revocar el rol de administrador";
  const pendingConfirmation = pendingAction
    ? pendingAction.action === "delete"
      ? t("admin.confirmDelete", { name: fullName(pendingAction.user) })
      : t("admin.confirmAction", { action: pendingActionLabel, name: fullName(pendingAction.user) })
    : "";

  return (
    <main className="admin-content">
      {pendingAction && (
        <div className="auth-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeConfirmationModal();
        }}>
          <section
            aria-labelledby="admin-confirmation-title"
            aria-modal="true"
            className={`auth-modal admin-confirm-modal${pendingAction.action === "delete" ? " danger" : ""}`}
            ref={confirmationDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="admin-confirm-icon">!</div>
            <p>CONFIRMAR ACCIÓN</p>
            <h2 id="admin-confirmation-title">¿Deseas continuar?</h2>
            <span>{pendingConfirmation}</span>
            {confirmationError && <p className="form-error" role="alert">{confirmationError}</p>}
            <div className="auth-modal-actions admin-confirm-actions">
              <button disabled={Boolean(busyUserId)} onClick={closeConfirmationModal} type="button">Cancelar</button>
              <button
                className="primary-button compact"
                disabled={Boolean(busyUserId)}
                onClick={() => void mutateUser()}
                type="button"
              >
                {busyUserId ? "Procesando…" : "Confirmar"}
              </button>
            </div>
          </section>
        </div>
      )}
      <header className="admin-header">
        <div>
          <p>{t("admin.eyebrow")}</p>
          <h1>{t("admin.title")}</h1>
          <span>
            {canDelete
              ? t("admin.superDescription")
              : t("admin.adminDescription")}
          </span>
        </div>
      </header>

      {message && <div className="admin-message" role="status">{message}</div>}

      <section className="admin-stat-grid">
        <article>
          <span><Icon name="manage_accounts" /></span>
          <small>{t("admin.totalVisible")}</small>
          <strong>{stats.total}</strong>
        </article>
        <article>
          <span><Icon name="check_circle" /></span>
          <small>{t("admin.activeSubscriptions")}</small>
          <strong>{stats.activeSubscriptions}</strong>
        </article>
        <article>
          <span><Icon name="payments" /></span>
          <small>{t("admin.successfulPayments")}</small>
          <strong>{stats.paidThisMonth}</strong>
        </article>
        <article>
          <span><Icon name="fact_check" /></span>
          <small>{t("admin.billingAttention")}</small>
          <strong>{stats.billingAttention}</strong>
        </article>
      </section>

      <section className="admin-table-card">
        <div className="admin-table-heading">
          <div>
            <h2>{t("admin.registeredUsers")}</h2>
            <p>{t("admin.suspendedCount", { count: stats.suspended })}</p>
          </div>
          <div className="table-card-actions">
            <label className="table-search">
              <Icon name="search" />
              <input
                aria-label={t("admin.searchUsers")}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder={t("admin.searchPlaceholder")}
                type="search"
                value={query}
              />
              {query && (
                <button className="table-search-submit" onClick={() => { setQuery(""); setPage(1); }} type="button">
                  {t("button.clear")}
                </button>
              )}
            </label>
            <span>{resultCount(filteredUsers.length, language)}</span>
          </div>
        </div>

        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("admin.user")}</th>
                <th>{t("admin.role")}</th>
                <th>{t("table.company")}</th>
                <th>{t("admin.activePlan")}</th>
                <th>{t("admin.billing")}</th>
                <th>{t("table.status")}</th>
                <th>{t("admin.registration")}</th>
                {canShowActions && <th>{t("table.actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length ? usersPage.items.map((user) => {
                const isSuspended = user.estado === "suspendido";
                const isBusy = busyUserId === user.id;
                const canChangeRole = canDelete && (user.rol === USER_ROLES.CLIENT || user.rol === USER_ROLES.ADMIN);

                return (
                  <tr key={user.id}>
                    <td>
                      <strong>{fullName(user)}</strong>
                      <small>{user.correo}</small>
                    </td>
                    <td><span className="admin-role-pill">{user.rolLabel}</span></td>
                    <td>
                      <strong>{user.companyName ?? t("common.noCompany")}</strong>
                      <small>{user.telefono || t("admin.noPhone")}</small>
                    </td>
                    <td>
                      <strong>{user.planName ?? t("admin.noPlan")}</strong>
                      <small>{formatMoney(user.billingAmount)} / {t("admin.perMonth")}</small>
                    </td>
                    <td>
                      <span className={billingStatusClass(user.billingStatus)}>{billingLabel(user.billingStatus, user.billingStatusLabel)}</span>
                      <small>{t("admin.next")}: {formatDate(user.nextBillingDate, language)}</small>
                    </td>
                    <td><span className={isSuspended ? "admin-status suspended" : "admin-status"}>{user.estado ?? "activo"}</span></td>
                    <td>{formatDate(user.fechaRegistro, language)}</td>
                    {canShowActions && (
                      <td>
                        <div className="admin-actions">
                          {canChangeRole && (
                            <button
                              className={user.rol === USER_ROLES.ADMIN ? "role-revoke" : ""}
                              disabled={isBusy}
                              onClick={() => requestUserMutation(user, user.rol === USER_ROLES.ADMIN ? "revoke_admin" : "assign_admin")}
                              type="button"
                            >
                              {user.rol === USER_ROLES.ADMIN ? "Revocar admin" : "Designar admin"}
                            </button>
                          )}
                          {canSuspend && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => requestUserMutation(user, isSuspended ? "activate" : "suspend")}
                            >
                              {isSuspended ? t("admin.activate") : t("admin.suspend")}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              className="danger"
                              type="button"
                              disabled={isBusy}
                              onClick={() => requestUserMutation(user, "delete")}
                            >
                              {t("admin.delete")}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={canShowActions ? 8 : 7}>
                    <div className="admin-empty">
                      <span><Icon name="manage_accounts" /></span>
                      <strong>{query ? t("admin.noUsersSearch") : t("admin.noUsers")}</strong>
                      <small>{query ? t("common.tryAnotherSearch") : t("admin.noUsersHelp")}</small>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredUsers.length > TABLE_PAGE_SIZE && (
          <nav className="table-pagination" aria-label={t("pagination.label")}>
            <span>{t("pagination.showing", { range: paginationRangeLabel(filteredUsers.length, usersPage.start, usersPage.end, language) })}</span>
            <div>
              <button disabled={usersPage.currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">
                <Icon name="chevron_left" />
              </button>
              {Array.from({ length: usersPage.totalPages }, (_, index) => index + 1).map((pageNumber) => (
                <button
                  className={pageNumber === usersPage.currentPage ? "is-active" : undefined}
                  key={pageNumber}
                  onClick={() => setPage(pageNumber)}
                  type="button"
                >
                  {pageNumber}
                </button>
              ))}
              <button disabled={usersPage.currentPage === usersPage.totalPages} onClick={() => setPage((value) => Math.min(usersPage.totalPages, value + 1))} type="button">
                <Icon name="chevron_right" />
              </button>
            </div>
          </nav>
        )}
      </section>
    </main>
  );
}
