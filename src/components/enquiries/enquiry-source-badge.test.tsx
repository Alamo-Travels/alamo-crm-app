import { render, screen } from '@testing-library/react';
import { EnquirySourceBadge } from './enquiry-source-badge';

describe('EnquirySourceBadge', () => {
  it('renders a "Website" badge for source: website', () => {
    render(<EnquirySourceBadge source="website" />);
    expect(screen.getByText('Website')).toBeInTheDocument();
  });

  it('renders nothing when source is absent — never "Staff"', () => {
    const { container } = render(<EnquirySourceBadge source={undefined} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Staff')).not.toBeInTheDocument();
    expect(screen.queryByText('Website')).not.toBeInTheDocument();
  });

  it('renders nothing for source: staff — the owner only asked to badge website enquiries', () => {
    const { container } = render(<EnquirySourceBadge source="staff" />);
    expect(container).toBeEmptyDOMElement();
  });
});
