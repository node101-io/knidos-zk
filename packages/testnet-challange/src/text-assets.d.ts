// HTML imports come in as strings via tsup's text loader (used to inline the
// pre-built sign-page HTML into the CLI bundle).
declare module '*.html' {
  const content: string;
  export default content;
}
