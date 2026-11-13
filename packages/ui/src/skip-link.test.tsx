import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { SkipLink } from './skip-link.js';

describe('SkipLink (US-108)', () => {
  it('is the first focusable element, links to the target and shows the given label', async () => {
    const user = userEvent.setup();
    render(
      <>
        <SkipLink targetId="main">Skip to content</SkipLink>
        <button type="button">Other</button>
        <main id="main" />
      </>,
    );
    await user.tab();
    const link = screen.getByRole('link', { name: 'Skip to content' });
    expect(link).toHaveFocus();
    expect(link).toHaveAttribute('href', '#main');
  });

  it('is visually hidden until focused and positioned with logical properties only', () => {
    render(<SkipLink targetId="main">Skip</SkipLink>);
    const classes = screen.getByRole('link').className;
    expect(classes).toContain('sr-only');
    expect(classes).toContain('focus:not-sr-only');
    expect(classes).not.toMatch(/(^|\s|:)(left|right|top|bottom|ml|mr|pl|pr)-/);
  });
});
