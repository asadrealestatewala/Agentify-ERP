import { useBackClose } from '../backNav.js';

/** Render this while a panel or menu is open: the phone Back button then closes it instead of leaving the screen. */
export default function BackLayer({ onClose }) { useBackClose(onClose); return null; }
