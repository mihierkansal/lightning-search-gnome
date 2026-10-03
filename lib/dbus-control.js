/*
 * Lightning Search Launcher, session bus control interface
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import Gio from "gi://Gio";

const BUS_NAME = "org.gnome.Shell.Extensions.LightningSearch";
const OBJECT_PATH = "/org/gnome/Shell/Extensions/LightningSearch";
const INTERFACE_XML = `
<node>
  <interface name="${BUS_NAME}">
    <method name="Toggle"/>
    <method name="Open"/>
    <method name="Hide"/>
    <method name="Search">
      <arg name="query" type="s" direction="in"/>
    </method>
  </interface>
</node>`;

export class ControlInterface {
  constructor({ onToggle, onOpen, onHide, onSearch }) {
    this._onToggle = onToggle;
    this._onOpen = onOpen;
    this._onHide = onHide;
    this._onSearch = onSearch;
    this._dbus = null;
    this._busNameId = 0;
  }

  Toggle() {
    this._onToggle();
  }

  Open() {
    this._onOpen();
  }

  Hide() {
    this._onHide();
  }

  Search(query) {
    this._onSearch(query);
  }

  enable() {
    this._dbus = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, this);
    try {
      this._dbus.export(Gio.DBus.session, OBJECT_PATH);
    } catch (error) {
      this._dbus = null;
      return error;
    }

    this._busNameId = Gio.bus_own_name(
      Gio.BusType.SESSION,
      BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      null,
      null,
      null,
    );
    return null;
  }

  disable() {
    if (this._busNameId) {
      Gio.bus_unown_name(this._busNameId);
      this._busNameId = 0;
    }
    if (!this._dbus) return;
    this._dbus.unexport();
    this._dbus = null;
  }
}
