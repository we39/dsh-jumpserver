# dsh-jumpserver tools

## Read-only tools

| Name | Summary |
| --- | --- |
| `jumpserver_list_assets` | List assets, optionally filtered by search. |
| `jumpserver_get_asset` | Get one asset by id. |
| `jumpserver_list_users` | List users, optionally filtered by search. |
| `jumpserver_get_user` | Get one user by id. |
| `jumpserver_list_accounts` | List asset accounts, optionally filtered by asset, username, or search. |
| `jumpserver_get_account` | Get one account by id. |
| `jumpserver_list_permissions` | List asset-permission rules, optionally filtered by user or asset. |
| `jumpserver_get_permission` | Get one asset-permission rule by id. |
| `jumpserver_list_sessions` | List terminal sessions, optionally filtered by user, asset, or finished status. |
| `jumpserver_list_commands` | List command audit records, optionally filtered by asset, account, user, session, risk level, or search. |
| `jumpserver_list_user_groups` | List user groups, optionally filtered by search. |
| `jumpserver_get_user_group` | Get one user group by id. |
| `jumpserver_list_command_groups` | List command groups, optionally filtered by search. |
| `jumpserver_get_command_group` | Get one command group by id. |
| `jumpserver_list_command_filters` | List command filters, optionally filtered by search. |
| `jumpserver_get_command_filter` | Get one command filter by id. |
| `jumpserver_list_nodes` | List asset-tree nodes, optionally filtered by search. |
| `jumpserver_get_node` | Get one asset-tree node by id. |
| `jumpserver_list_roles` | List RBAC roles, optionally filtered by search and scope. |
| `jumpserver_get_role` | Get one RBAC role by id. |
| `jumpserver_list_role_bindings` | List role bindings, optionally filtered by user or role. |

## Write tools

| Name | Summary |
| --- | --- |
| `jumpserver_create_asset` | Create asset. |
| `jumpserver_update_asset` | Update asset. |
| `jumpserver_delete_asset` | Delete asset. |
| `jumpserver_create_account` | Create account. |
| `jumpserver_update_account` | Update account. |
| `jumpserver_delete_account` | Delete account. |
| `jumpserver_create_user` | Create user. |
| `jumpserver_update_user` | Update user. |
| `jumpserver_delete_user` | Delete user. |
| `jumpserver_reset_user_mfa` | Reset user MFA binding. |
| `jumpserver_reset_user_ssh_key` | Reset user SSH key. |
| `jumpserver_create_permission` | Create asset-permission rule. |
| `jumpserver_update_permission` | Update asset-permission rule. |
| `jumpserver_delete_permission` | Delete asset-permission rule. |
| `jumpserver_create_user_group` | Create user group. |
| `jumpserver_update_user_group` | Update user group. |
| `jumpserver_delete_user_group` | Delete user group. |
| `jumpserver_create_command_group` | Create command group. |
| `jumpserver_update_command_group` | Update command group. |
| `jumpserver_delete_command_group` | Delete command group. |
| `jumpserver_create_command_filter` | Create command filter. |
| `jumpserver_update_command_filter` | Update command filter. |
| `jumpserver_delete_command_filter` | Delete command filter. |
| `jumpserver_create_domain` | Create network domain. |
| `jumpserver_update_domain` | Update network domain. |
| `jumpserver_delete_domain` | Delete network domain. |
| `jumpserver_create_gateway` | Create gateway. |
| `jumpserver_update_gateway` | Update gateway. |
| `jumpserver_delete_gateway` | Delete gateway. |
| `jumpserver_create_label` | Create label. |
| `jumpserver_update_label` | Update label. |
| `jumpserver_delete_label` | Delete label. |
| `jumpserver_create_node` | Create asset-tree node. |
| `jumpserver_update_node` | Rename asset-tree node. |
| `jumpserver_delete_node` | Delete asset-tree node. |
| `jumpserver_move_node` | Re-parent asset-tree node. |
| `jumpserver_create_role` | Create RBAC role. |
| `jumpserver_update_role` | Update RBAC role. |
| `jumpserver_delete_role` | Delete RBAC role. |
| `jumpserver_create_role_binding` | Create role binding. |
| `jumpserver_delete_role_binding` | Delete role binding. |
