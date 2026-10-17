"""vars.* : variable presets, design variables and user parms."""
from __future__ import annotations

from engine.vspctx import vsp
from engine.registry import method, RpcError
from engine.parmutil import parm_dict

_DESIGN_TYPES = {"var": vsp.XDDM_VAR, "const": vsp.XDDM_CONST}
_USER_TYPES = {"double": vsp.PARM_DOUBLE_TYPE, "int": vsp.PARM_INT_TYPE}


def _group_of_setting(setting_id: str) -> str:
    for gid in vsp.GetVarPresetGroups():
        if setting_id in vsp.GetVarPresetSettings(gid):
            return gid
    raise RpcError(f"no preset setting {setting_id}")


def _check_group(group_id: str) -> None:
    if group_id not in vsp.GetVarPresetGroups():
        raise RpcError(f"no preset group {group_id}")


@method("vars.presets")
def presets() -> dict:
    groups = []
    for gid in vsp.GetVarPresetGroups():
        groups.append({
            "id": gid,
            "name": vsp.GetGroupName(gid),
            "settings": [
                {"id": sid, "name": vsp.GetSettingName(sid)}
                for sid in vsp.GetVarPresetSettings(gid)
            ],
            "parms": [parm_dict(pid) for pid in vsp.GetVarPresetParmIDs(gid)],
        })
    return {"groups": groups}


@method("vars.addGroup", mutates=True)
def add_group(name: str) -> None:
    vsp.AddVarPresetGroup(name)


@method("vars.addSetting", mutates=True)
def add_setting(groupId: str, name: str) -> None:
    _check_group(groupId)
    vsp.AddVarPresetSetting(groupId, name)


@method("vars.addParm", mutates=True)
def add_parm(groupId: str, parmId: str) -> None:
    _check_group(groupId)
    vsp.AddVarPresetParm(groupId, parmId)


@method("vars.applySetting", mutates=True)
def apply_setting(settingId: str) -> None:
    vsp.ApplyVarPresetSetting(_group_of_setting(settingId), settingId)


@method("vars.saveSetting", mutates=True)
def save_setting(settingId: str) -> None:
    vsp.SaveVarPresetParmVals(_group_of_setting(settingId), settingId)


@method("vars.deleteGroup", mutates=True)
def delete_group(groupId: str) -> None:
    _check_group(groupId)
    vsp.DeleteVarPresetGroup(groupId)


@method("vars.deleteSetting", mutates=True)
def delete_setting(settingId: str) -> None:
    vsp.DeleteVarPresetSetting(_group_of_setting(settingId), settingId)


@method("vars.deleteParm", mutates=True)
def delete_parm(groupId: str, parmId: str) -> None:
    _check_group(groupId)
    vsp.DeleteVarPresetParm(groupId, parmId)


@method("vars.designVars")
def design_vars() -> list[dict]:
    out = []
    for i in range(vsp.GetNumDesignVars()):
        pid = vsp.GetDesignVar(i)
        t = "const" if vsp.GetDesignVarType(i) == vsp.XDDM_CONST else "var"
        out.append({"parm": parm_dict(pid), "type": t})
    return out


@method("vars.addDesignVar", mutates=True)
def add_design_var(parmId: str, type: str) -> None:
    if type not in _DESIGN_TYPES:
        raise RpcError(f"design var type must be 'var' or 'const', got {type!r}")
    vsp.AddDesignVar(parmId, _DESIGN_TYPES[type])


@method("vars.clearDesignVars", mutates=True)
def clear_design_vars() -> None:
    vsp.DeleteAllDesignVars()


@method("vars.writeDes")
def write_des(path: str) -> None:
    vsp.WriteDESFile(path)


@method("vars.readDes", mutates=True)
def read_des(path: str) -> None:
    vsp.ReadApplyDESFile(path)


@method("vars.writeXddm")
def write_xddm(path: str) -> None:
    vsp.WriteXDDMFile(path)


@method("vars.readXddm", mutates=True)
def read_xddm(path: str) -> None:
    vsp.ReadApplyXDDMFile(path)


@method("vars.userParms")
def user_parms() -> list[dict]:
    return [parm_dict(pid) for pid in vsp.GetAllUserParms()]


@method("vars.addUserParm", mutates=True)
def add_user_parm(type: str, name: str, group: str) -> dict:
    if type not in _USER_TYPES:
        raise RpcError(f"user parm type must be 'double' or 'int', got {type!r}")
    pid = vsp.AddUserParm(_USER_TYPES[type], name, group)
    return parm_dict(pid)
