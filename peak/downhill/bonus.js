// Time off the clock: a strike, a spare (seven to nine down), and a long ski jump, by the metre past 20 m and double
// past the K line. Once a run: bowling again after a respawn earns only what a better score adds, and a longer jump
// only what it adds, so a run's bonus is its best bowl plus its longest jump. The score server works it out the same
// way from the replay (server/downhill.py), so these numbers go into the route it checks against (routedata.js).
import { K_LINE } from './marks.js';

export const BONUS = { pins: { 7: 1.5, 8: 2, 9: 3, 10: 5 }, from: 20, metre: 0.2, kLine: K_LINE };

// seconds off for a jump of d metres, to a tenth
export const jumpBonus = d => Math.round(10 * BONUS.metre * (Math.max(0, d - BONUS.from) + Math.max(0, d - K_LINE))) / 10;

// seconds off for knocking down this many pins
export const pinsBonus = down => BONUS.pins[down] ?? 0;

// the whole bonus in ms, from the best bowl and the longest jump (as the server adds it up)
export const bonusMs = (bowled, jump) => Math.round(1000 * bowled) + Math.round(1000 * jumpBonus(jump));
