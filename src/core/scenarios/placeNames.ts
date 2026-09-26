/**
 * The project's own Baltic place names (art direction "Originality rules").
 *
 * Each is an invented compound built from common Latvian and Lithuanian
 * place-name patterns: a landscape word (oak, willow, rye, wind, crane, pine,
 * lake) joined to a settlement or terrain ending (-mala edge, -ciems village,
 * -upe/-upis river, -kalns/-kalni hill, -lauki fields, -ėnai/-ūnai folk,
 * -ynė grove). None is taken from the mood reference or any other game, and
 * none is chosen to name a real town. The spellings exercise the diacritics
 * the label font subset must cover (ā č ē ģ ī ķ ļ ņ š ū ž ą ę ė į ų).
 *
 * Towns draw from the front of the list; later slices name stations from it
 * by ID, so only ever append.
 */
export const BALTIC_PLACE_NAMES: readonly string[] = Object.freeze([
  "Ozolmala",
  "Kārkluciems",
  "Rudzupe",
  "Vējkalni",
  "Dzērvāji",
  "Priežkalns",
  "Ķiršlauki",
  "Medņupe",
  "Egļusala",
  "Līčupe",
  "Žagarkalns",
  "Ąžuolynė",
  "Šilmėnai",
  "Ežerūnai",
  "Vėjupis",
  "Rugiškiai",
  "Gluosnėnai",
  "Pūpolciems",
]);
