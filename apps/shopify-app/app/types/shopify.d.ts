// Vite asset URL imports (e.g. `import x from "foo.css?url"`).
declare module "*?url" {
  const url: string;
  export default url;
}

// Shopify App Bridge web components. These are mounted by AppProvider at runtime;
// declaring them keeps tsc + JSX happy.
declare namespace JSX {
  interface IntrinsicElements {
    "ui-nav-menu": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "ui-title-bar": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      title?: string;
    };
  }
}
