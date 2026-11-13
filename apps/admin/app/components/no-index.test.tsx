import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react';

import { NoIndex } from './no-index';

describe('NoIndex (PR4-SEC-05)', () => {
  it('puts a robots noindex, nofollow meta element in the document head', () => {
    render(<NoIndex />);
    const tag = document.head.querySelector('meta[name="robots"]');
    expect(tag).not.toBeNull();
    expect(tag?.getAttribute('content')).toBe('noindex, nofollow');
  });
});
