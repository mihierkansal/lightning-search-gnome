import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import GObject from "gi://GObject";

const genParam = (type, name, ...dflt) =>
  GObject.ParamSpec[type](
    name,
    name,
    name,
    GObject.ParamFlags.READWRITE,
    ...dflt,
  );

export const ShortcutSettingWidget = class extends Gtk.Button {
  static {
    GObject.registerClass(
      {
        Properties: {
          shortcut: genParam("string", "shortcut", ""),
        },
        Signals: {
          changed: { param_types: [GObject.TYPE_STRING] },
        },
      },
      this,
    );
  }

  constructor(settings, key) {
    super({ valign: Gtk.Align.CENTER, has_frame: false });
    this._settings = settings;
    this._key = key;
    this.connect("clicked", this._onActivated.bind(this));

    const label = new Gtk.ShortcutLabel({ disabled_text: "Set shortcut..." });
    this.set_child(label);
    this.bind_property(
      "shortcut",
      label,
      "accelerator",
      GObject.BindingFlags.DEFAULT,
    );
    [this.shortcut] = this._settings.get_strv(this._key);
  }

  _onActivated(widget) {
    const controller = new Gtk.EventControllerKey();

    if (!this._editor) {
      this._editor = new Gtk.Window({
        title: "Set Shortcut",
        modal: true,
        hide_on_close: true,
        transient_for: widget.get_root(),
        width_request: 420,
        height_request: 120,
      });
      this._editor.set_child(
        new Gtk.Label({
          label: "Press new shortcut\nBackspace to clear, Esc to cancel",
          justify: Gtk.Justification.CENTER,
        }),
      );
    }

    this._editor.add_controller(controller);
    controller.connect("key-pressed", this._onKeyPressed.bind(this));
    this._editor.present();
  }

  _onKeyPressed(_widget, keyval, keycode, state) {
    let mask = state & Gtk.accelerator_get_default_mod_mask();
    mask &= ~Gdk.ModifierType.LOCK_MASK;

    if (!mask && keyval === Gdk.KEY_Escape) {
      this._editor.close();
      return Gdk.EVENT_STOP;
    }

    if (keyval === Gdk.KEY_BackSpace) {
      this._saveShortcut();
      return Gdk.EVENT_STOP;
    }

    if (
      !this._isValidBinding(mask, keycode, keyval) ||
      !this._isValidAccel(mask, keyval)
    )
      return Gdk.EVENT_STOP;

    this._saveShortcut(keyval, keycode, mask);
    return Gdk.EVENT_STOP;
  }

  _saveShortcut(keyval, keycode, mask) {
    this.shortcut =
      !keyval && !keycode
        ? ""
        : Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);

    this.emit("changed", this.shortcut);
    this._settings.set_strv(this._key, [this.shortcut]);
    this._editor.close();
  }

  _keyvalIsForbidden(keyval) {
    return [
      Gdk.KEY_Home,
      Gdk.KEY_Left,
      Gdk.KEY_Up,
      Gdk.KEY_Right,
      Gdk.KEY_Down,
      Gdk.KEY_Page_Up,
      Gdk.KEY_Page_Down,
      Gdk.KEY_End,
      Gdk.KEY_Tab,
      Gdk.KEY_KP_Enter,
      Gdk.KEY_Return,
      Gdk.KEY_Mode_switch,
    ].includes(keyval);
  }

  _isValidBinding(mask, keycode, keyval) {
    return !(
      mask === 0 ||
      (mask === Gdk.SHIFT_MASK &&
        keycode !== 0 &&
        ((keyval >= Gdk.KEY_a && keyval <= Gdk.KEY_z) ||
          (keyval >= Gdk.KEY_A && keyval <= Gdk.KEY_Z) ||
          (keyval >= Gdk.KEY_0 && keyval <= Gdk.KEY_9) ||
          this._keyvalIsForbidden(keyval)))
    );
  }

  _isValidAccel(mask, keyval) {
    return (
      Gtk.accelerator_valid(keyval, mask) ||
      (keyval === Gdk.KEY_Tab && mask !== 0)
    );
  }
};
