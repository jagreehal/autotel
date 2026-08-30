import { describe, expect, it } from 'vitest';
import {
  APP,
  AUTOTEL_WEB,
  BROWSER,
  SESSION,
  USER_AGENT,
  WEB_EVENT,
} from './semconv';

// These strings are the contract with every backend that ships an OpenTelemetry
// browser dashboard. A typo here is invisible at runtime and silently empties a
// panel, so they are pinned rather than trusted.
describe('canonical OpenTelemetry names', () => {
  it('pins browser attributes', () => {
    expect(BROWSER).toEqual({
      LANGUAGE: 'browser.language',
      MOBILE: 'browser.mobile',
      PLATFORM: 'browser.platform',
      BRANDS: 'browser.brands',
      DOCUMENT_URL_FULL: 'browser.document.url.full',
    });
  });

  it('pins user agent attributes', () => {
    expect(USER_AGENT).toEqual({
      NAME: 'user_agent.name',
      VERSION: 'user_agent.version',
      OS_NAME: 'user_agent.os.name',
      OS_VERSION: 'user_agent.os.version',
      SYNTHETIC_TYPE: 'user_agent.synthetic.type',
    });
  });

  it('pins app attributes', () => {
    expect(APP).toEqual({
      SCREEN_ID: 'app.screen.id',
      SCREEN_NAME: 'app.screen.name',
      SCREEN_COORDINATE_X: 'app.screen.coordinate.x',
      SCREEN_COORDINATE_Y: 'app.screen.coordinate.y',
      WIDGET_ID: 'app.widget.id',
      WIDGET_NAME: 'app.widget.name',
      JANK_FRAME_COUNT: 'app.jank.frame_count',
      JANK_PERIOD: 'app.jank.period',
      JANK_THRESHOLD: 'app.jank.threshold',
    });
  });

  it('pins session attributes', () => {
    expect(SESSION).toEqual({
      ID: 'session.id',
      PREVIOUS_ID: 'session.previous_id',
    });
  });

  it('pins event names', () => {
    expect(WEB_EVENT).toEqual({
      WIDGET_CLICK: 'app.widget.click',
      SCREEN_CLICK: 'app.screen.click',
      WEB_VITAL: 'browser.web_vital',
      JANK: 'app.jank',
      SESSION_START: 'session.start',
      SESSION_END: 'session.end',
    });
  });

  it('keeps autotel extensions under their canonical event prefix', () => {
    // An extension that squats on a canonical name is worse than one that is
    // obviously ours, so every key here must extend a name the spec owns.
    for (const value of Object.values(AUTOTEL_WEB)) {
      expect(value).toMatch(/^(app|browser|session)\./);
    }
  });
});
