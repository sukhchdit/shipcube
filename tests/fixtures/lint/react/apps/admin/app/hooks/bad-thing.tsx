import { useState } from 'react';

export const Thing = ({ on }: { on: boolean }) => {
  if (on) {
    const [value] = useState(0);
    return <span>{value}</span>;
  }
  return null;
};
