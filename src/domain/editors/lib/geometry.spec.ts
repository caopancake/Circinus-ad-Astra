import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  clampArc,
  distance,
  distanceToSegment,
  normalizeDegree,
  pointAngle,
  pointAngleScreen,
  pointArc,
  roundDegree,
} from './geometry';

describe('degree helpers', () => {
  it('rounds degrees to the nearest integer', () => {
    expect(roundDegree(10.4)).toBe(10);
    expect(roundDegree(10.6)).toBe(11);
    expect(roundDegree(-0.5)).toBe(-0);
  });

  it('normalizes degrees into 0..360 with negative wrap', () => {
    expect(normalizeDegree(370)).toBe(10);
    expect(normalizeDegree(-10)).toBe(350);
    expect(normalizeDegree(-720) + 0).toBe(0);
    expect(normalizeDegree(359.6)).toBe(0);
  });

  it('clamps arcs into 0..360', () => {
    expect(clampArc(-5)).toBe(0);
    expect(clampArc(400)).toBe(360);
    expect(clampArc(120.4)).toBe(120);
  });

  it('measures the shortest unsigned delta between angles', () => {
    expect(angleDelta(0, 90)).toBe(90);
    expect(angleDelta(0, 270)).toBe(90);
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(45, 45)).toBe(0);
  });
});

describe('point math', () => {
  it('computes distance treating missing coordinates as zero', () => {
    expect(distance([3, 4], [0, 0])).toBe(5);
    expect(distance([1], [1, 0])).toBe(0);
    expect(distance([], [])).toBe(0);
  });

  it('computes point angles in the flipped ship coordinate system', () => {
    expect(pointAngle([0, 0], [0, 5])).toBe(0);
    expect(pointAngle([0, 0], [-5, 0])).toBe(90);
    expect(pointAngle([0, 0], [0, -5])).toBe(180);
    expect(pointAngle([0, 0], [5, 0])).toBe(270);
  });

  it('computes point angles in plain screen coordinates without flipping', () => {
    expect(pointAngleScreen({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
    expect(pointAngleScreen({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(90);
    expect(pointAngleScreen({ x: 0, y: 0 }, { x: -1, y: 0 })).toBe(180);
  });

  it('derives the arc covering the shortest swing from the facing angle', () => {
    expect(pointArc([0, 0], [0, 5], 0)).toBe(0);
    expect(pointArc([0, 0], [5, 5], 0)).toBe(90);
    expect(pointArc([0, 0], [0, -5], 90)).toBe(180);
  });
});

describe('distanceToSegment', () => {
  it('returns point distance for a degenerate segment', () => {
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5);
  });

  it('returns zero for a point on the segment', () => {
    expect(distanceToSegment([1, 1], [0, 0], [2, 2])).toBe(0);
  });

  it('clamps the projection to the segment endpoints', () => {
    expect(distanceToSegment([3, 0], [0, 0], [2, 0])).toBe(1);
    expect(distanceToSegment([-1, 0], [0, 0], [2, 0])).toBe(1);
  });

  it('measures the perpendicular distance to the segment interior', () => {
    expect(distanceToSegment([1, 2], [0, 0], [2, 0])).toBe(2);
  });
});
