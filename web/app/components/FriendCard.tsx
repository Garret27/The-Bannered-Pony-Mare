"use client";

import styles from "./FriendCard.module.css";

export type FriendCardTarget = {
  userId: string;
  displayName: string;
  distinctSaturdays?: number;
  distinctTuesdays?: number;
  lastSeenLabel?: string;
};

export type FriendCardManageAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";
};

type FriendCardProps = {
  target: FriendCardTarget;
  variant: "inInstance" | "inviteable" | "blacklisted" | "offlineRegular";
  invited?: boolean;
  bulkMode?: boolean;
  selected?: boolean;
  loading?: boolean;
  onToggle?: () => void;
  onInvite?: (withMessage: boolean) => void;
  manageActions?: FriendCardManageAction[];
};

export function FriendCard({
  target,
  variant,
  invited = false,
  bulkMode = false,
  selected = false,
  loading = false,
  onToggle,
  onInvite,
  manageActions = [],
}: FriendCardProps) {
  const classNames = [
    styles.card,
    variant === "inInstance" ? styles.inInstance : "",
    variant === "blacklisted" ? styles.blacklisted : "",
    variant === "offlineRegular" ? styles.offlineRegular : "",
    invited ? styles.invited : "",
    loading ? styles.loading : "",
  ]
    .filter(Boolean)
    .join(" ");

  const hasManage = manageActions.length > 0;
  const showInviteOverlay =
    !bulkMode &&
    variant === "inviteable" &&
    !invited &&
    !loading &&
    !hasManage;

  return (
    <div className={classNames} title={target.displayName}>
      {bulkMode && variant === "inviteable" && !invited && (
        <label className={styles.checkboxWrap}>
          <input
            type="checkbox"
            checked={selected}
            disabled={loading}
            onChange={onToggle}
          />
        </label>
      )}

      <span className={styles.name}>{target.displayName}</span>

      {(target.distinctSaturdays !== undefined ||
        target.distinctTuesdays !== undefined) && (
        <span className={styles.meta}>
          {[
            target.distinctSaturdays !== undefined
              ? `${target.distinctSaturdays} Sat`
              : null,
            target.distinctTuesdays !== undefined
              ? `${target.distinctTuesdays} Tue`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}

      {target.lastSeenLabel && (
        <span className={styles.meta}>{target.lastSeenLabel}</span>
      )}

      {variant === "offlineRegular" && (
        <span className={styles.badgeOffline}>Offline</span>
      )}

      {variant === "blacklisted" && (
        <span className={styles.badgeBlocked}>Blocked</span>
      )}

      {invited && variant === "inviteable" && (
        <span className={styles.badgeInvited}>Invited</span>
      )}

      {showInviteOverlay && (
        <div className={styles.overlay}>
          <button
            type="button"
            onClick={() => onInvite?.(false)}
            disabled={loading}
          >
            Invite
          </button>
          <button
            type="button"
            className={styles.overlaySecondary}
            onClick={() => onInvite?.(true)}
            disabled={loading}
          >
            Invite with message
          </button>
        </div>
      )}

      {hasManage && (
        <div className={styles.overlay}>
          {manageActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={
                action.variant === "danger"
                  ? styles.overlayDanger
                  : styles.overlayManage
              }
              onClick={action.onClick}
              disabled={action.disabled || loading}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {loading && variant === "inviteable" && !hasManage && (
        <div className={styles.overlay}>
          <span className={styles.spinner}>Sending…</span>
        </div>
      )}
    </div>
  );
}
