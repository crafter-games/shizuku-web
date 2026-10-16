/** Names for the MAX engine's bytecode, after XLVNS sizuku.c. Unknown ones are named by their behaviour there. */
export const OP_NAMES: Record<number, string> = {
  0x00: 'fin', 0x01: 'efecto', 0x03: '?03', 0x04: 'saltar', 0x05: 'elegir', 0x06: '?06',
  0x07: 'marca-elección', 0x0a: 'fondo', 0x14: 'rellenar', 0x15: 'borrar', 0x16: 'escena-h', 0x22: 'personaje',
  0x24: 'personaje-c', 0x28: 'antes-elegir', 0x38: 'mostrar', 0x3d: 'si-igual', 0x3e: 'si-distinto',
  0x47: 'flag=', 0x48: 'flag+=', 0x54: 'texto', 0x5a: '?5a', 0x5c: '?5c', 0x60: '?60', 0x61: '?61',
  0x62: '?62', 0x63: '?63', 0x64: '?64', 0x65: '?65', 0x66: '?66', 0x6e: 'música', 0x6f: '?6f',
  0x73: '?73', 0x7c: '?7c', 0x7d: 'final', 0x7e: 'nº-final', 0xff: 'inalcanzable',
};
