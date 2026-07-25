/**
 * Lantern Leap — level content.
 *
 * String art, one row per line, top to bottom. Every level here is checked
 * by `validateLevel` against the real jump numbers, so an unreachable coin
 * or an uncrossable gap fails the build rather than the player.
 */

import { parseLevel, type Level } from "./level";

/* ------------------------------------------------------------------ */

/*
  Legend
    #  solid      =  one-way     /  slope up-right   \  slope up-left
    ^  hazard     ~  ice         b  bounce pad
    o  coin       *  gem         L  lantern (checkpoint)
    e  walker     f  flyer       s  spinner
    p  spawn      G  goal
*/

const LANTERN_HOLLOW = [
  "                                                                                            ",
  "                                                                                            ",
  "                    o o o                                    * *                            ",
  "                   =======                                  =====                           ",
  "                                          f                                                 ",
  "            o o                                     o o o                        o o        ",
  "           =====                 L                 =======                      ====        ",
  "                                                                                            ",
  "     p              e                    o o o                    e         e            G  ",
  "  ########      ##########             =========            ############   #############    ",
  "  ########      ##########    /###\\                         ############   #############    ",
  "  ########      ##########   /#####\\      ^^^^^     b       ############   #############    ",
  "  ##############################################   ###   ###############################    ",
];

const FROSTGLASS_CLIMB = [
  "                                                                              ",
  "                              * *                                             ",
  "                             =====                                  o o o  G  ",
  "                                                                  ##########  ",
  "                  o o                          f                              ",
  "                 =====                                    b                   ",
  "                                    o o o             ########                ",
  "        L                          =======                                    ",
  "                        e                             o o                     ",
  "   p              ~~~~~~~~~~~~                       ======                   ",
  "  #####          ##############           s                                   ",
  "  #####    ^^^   ##############                    ############               ",
  "  ##################################   ^^^^^^   ###############               ",
];

export const LANTERN_LEAP_LEVELS: Level[] = [
  parseLevel({ id: "lantern-hollow", name: "Lantern Hollow", theme: "dusk", parTime: 150 }, LANTERN_HOLLOW),
  parseLevel({ id: "frostglass-climb", name: "Frostglass Climb", theme: "grove", parTime: 165 }, FROSTGLASS_CLIMB),
];

export function levelById(id: string) {
  return LANTERN_LEAP_LEVELS.find((level) => level.id === id) ?? LANTERN_LEAP_LEVELS[0];
}
