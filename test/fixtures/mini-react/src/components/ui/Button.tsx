import * as React from "react";

/** The shadcn shape: a component whose initializer is React.forwardRef(...). */
export const Button = React.forwardRef((props: { label: string }, ref: never) => (
  <button ref={ref}>{props.label}</button>
));
