import { describe, expect, it } from 'vitest';
import {
  AppError,
  buildModOpeningFailure,
  errorDiagnosticOf,
  extractFileReferenceFromError,
  fileReferenceLocationSuffix,
  formatError,
  withCause,
  warningNotice,
} from './errors';

const diagnostic = {
  code: 'parse.json_syntax',
  message: 'Raw parser detail',
  location: { path: 'D:/mods/demo/demo.skin', line: 5, column: 44 },
};

describe('error diagnostic projections', () => {
  it.each(['constructor', '__proto__', 'toString'])('keeps an unmapped code %s as its raw diagnostic', (code) => {
    expect(formatError({ code, message: 'Raw unknown detail', location: null })).toBe('Raw unknown detail');
  });
  it('keeps the stable code, raw context chain and structured location through wrappers', () => {
    const error = withCause('保存失败', withCause('写盘失败', diagnostic, 'write'), 'save');
    expect(errorDiagnosticOf(error)).toEqual({
      ...diagnostic,
      message: 'Raw parser detail',
    });
    expect(formatError(error)).toBe('保存失败：写盘失败：JSON 语法错误');
    expect(extractFileReferenceFromError(error)).toMatchObject({ path: diagnostic.location.path, line: 5, column: 44 });
  });

  it('keeps own frontend code separate from action identity', () => {
    const error = new AppError('Session projection pending', { action: 'query-session', code: 'session.projection_pending' });
    expect(errorDiagnosticOf(error).code).toBe('session.projection_pending');
    expect(formatError(error)).toBe('内容已保存，等待项目同步，请重试同步');
  });

  it('uses the structured location independently of mapped copy and file extension', () => {
    expect(extractFileReferenceFromError(diagnostic)).toEqual({
      path: 'D:/mods/demo/demo.skin',
      line: 5,
      column: 44,
      message: 'JSON 语法错误',
    });
  });

  it('represents parser position before a file owner binds the path', () => {
    expect(errorDiagnosticOf({ ...diagnostic, location: { path: null, line: 7, column: 9 } }).location).toEqual({
      path: null,
      line: 7,
      column: 9,
    });
    expect(extractFileReferenceFromError({ ...diagnostic, location: { path: null, line: 7, column: 9 } })).toBeNull();
  });

  it('authorizes a structured recovery target using the trusted root', () => {
    const failure = buildModOpeningFailure('\\\\?\\D:\\mods\\demo', diagnostic);
    expect(failure.file).toEqual({ path: diagnostic.location.path, line: 5, column: 44 });
    expect(failure.diagnostic).toEqual(diagnostic);
    expect(buildModOpeningFailure('D:/mods/other', diagnostic).file).toBeNull();
  });

  it('keeps warning user copy separate from raw diagnostics', () => {
    expect(warningNotice('ID 已存在', 'config.entity_exists', 'ID exists: demo')).toEqual({
      userMessage: 'ID 已存在',
      diagnostic: { code: 'config.entity_exists', message: 'ID exists: demo', location: null },
    });
  });

  it('formats line and column display', () => {
    expect(fileReferenceLocationSuffix(5, 44)).toBe('第 5 行，第 44 列');
    expect(fileReferenceLocationSuffix(9)).toBe('第 9 行');
  });
});
