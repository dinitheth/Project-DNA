import { describe, it, expect } from 'vitest';
import { Ok, Err, isOk, isErr } from '../result/result.js';
import type { Result } from '../result/result.js';

describe('Result', () => {
  describe('Ok', () => {
    it('should create a successful result', () => {
      const result = Ok(42);
      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });

    it('should work with complex types', () => {
      const result = Ok({ name: 'DNA', items: [1, 2, 3] });
      expect(result.ok).toBe(true);
      expect(result.value.name).toBe('DNA');
    });
  });

  describe('Err', () => {
    it('should create a failed result', () => {
      const result = Err(new Error('something went wrong'));
      expect(result.ok).toBe(false);
      expect(result.error.message).toBe('something went wrong');
    });

    it('should work with custom error types', () => {
      interface ParseError {
        code: string;
        line: number;
      }
      const result = Err<ParseError>({ code: 'SYNTAX_ERROR', line: 42 });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('SYNTAX_ERROR');
    });
  });

  describe('isOk', () => {
    it('should narrow to OkResult', () => {
      const result: Result<number> = Ok(42);
      if (isOk(result)) {
        // TypeScript should allow accessing .value here
        expect(result.value).toBe(42);
      } else {
        throw new Error('Should have been Ok');
      }
    });

    it('should return false for Err', () => {
      const result: Result<number> = Err(new Error('fail'));
      expect(isOk(result)).toBe(false);
    });
  });

  describe('isErr', () => {
    it('should narrow to ErrResult', () => {
      const result: Result<number> = Err(new Error('fail'));
      if (isErr(result)) {
        // TypeScript should allow accessing .error here
        expect(result.error.message).toBe('fail');
      } else {
        throw new Error('Should have been Err');
      }
    });

    it('should return false for Ok', () => {
      const result: Result<number> = Ok(42);
      expect(isErr(result)).toBe(false);
    });
  });
});
