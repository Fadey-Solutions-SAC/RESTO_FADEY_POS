/** Secreto JWT — módulo sin dependencias para evitar ciclos auth ↔ staffJwt. */
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET es obligatorio. Define la variable de entorno antes de iniciar el servidor.');
}

module.exports = { JWT_SECRET };
