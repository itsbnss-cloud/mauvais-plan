// Réglages de jeu partagés entre le serveur et le client.

export const WORLD_W = 1280;
export const WORLD_H = 704;

/** Fréquence de simulation du serveur. */
export const SERVER_TICK_RATE = 60;
/** Fréquence d'envoi de l'état aux clients. */
export const SNAPSHOT_RATE = 20;
/** Chaque commande client représente un pas de déplacement de cette durée. */
export const INPUT_RATE = 30;
export const INPUT_DT = 1 / INPUT_RATE;
/** Au-delà, une commande est considérée comme périmée (focus perdu, coupure). */
export const INPUT_STALE_AFTER = 0.3;

export const PLAYER_RADIUS = 13;
export const PLAYER_SPEED = 165;
export const CARRY_SMALL_SPEED = 125;
export const CARRY_BIG_SPEED = 95;

export const GUARD_RADIUS = 14;
export const GUARD_PATROL_SPEED = 75;
export const GUARD_INVESTIGATE_SPEED = 105;
export const GUARD_CHASE_SPEED = 135;
export const GUARD_VIEW_RANGE = 185;
export const GUARD_VIEW_HALF_ANGLE = (38 * Math.PI) / 180;
export const GUARD_CATCH_DIST = PLAYER_RADIUS + GUARD_RADIUS + 4;
/** Temps sans voir la cible avant d'abandonner la poursuite. */
export const GUARD_LOSE_TIME = 3;
export const GUARD_SEARCH_TIME = 2.5;
export const GUARD_STUN_TIME = 1.6;

export const CAMERA_RANGE = 300;
export const CAMERA_HALF_ANGLE = (28 * Math.PI) / 180;

export const PICK_RANGE = 46;
export const GRAB_RANGE = 34;
export const SWITCH_RANGE = 42;
export const LOCK_RANGE = 46;
export const FREE_HOLD_TIME = 2;
export const KEYPAD_RANGE = 44;
export const NOTE_RANGE = 40;
/** Délai minimal entre deux essais de code (anti-force brute). */
export const KEYPAD_COOLDOWN = 1.5;
export const MAX_GUARDS = 2;
export const MAX_CAMERAS = 2;

export const COUNTDOWN = 3;
export const RECONNECT_GRACE_MS = 60_000;

// Mode solo : règles adaptées à un seul cambrioleur.
export const SOLO_BIG_SPEED = 60;
export const SOLO_JAIL_TIME = 10;
export const SOLO_CAMERA_OFF_TIME = 8;

export const MAX_NAME_LENGTH = 16;

export const PLAYER_COLORS = ['violet', 'orange'] as const;
