declare module "*.png" {
  // Metro gives an image module a numeric asset id.
  const source: number;
  export default source;
}
