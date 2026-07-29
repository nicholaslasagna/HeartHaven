/**
 * Moonberry Racing — the course roster.
 *
 * Every course here is checked by `validateCourse` in
 * `checks/moonberry-racing.ts`, so a circuit that does not close, a corner
 * tighter than a kart can hold, or a shortcut that skips a checkpoint fails
 * the check rather than the player.
 */

import type { Course } from "../track";
import { MOONBERRY_SPEEDWAY } from "./moonberry-speedway";
import { SUGARGEAR_FACTORY } from "./sugargear-factory";
import { FROSTING_FALLS } from "./frosting-falls";

export const MOONBERRY_COURSES: Course[] = [
  MOONBERRY_SPEEDWAY,
  SUGARGEAR_FACTORY,
  FROSTING_FALLS,
];

export function courseById(id: string) {
  return MOONBERRY_COURSES.find((course) => course.id === id) ?? MOONBERRY_COURSES[0];
}

export { MOONBERRY_SPEEDWAY, SUGARGEAR_FACTORY, FROSTING_FALLS };
