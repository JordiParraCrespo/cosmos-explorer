package message_type

import (
	utils "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/utils"
	msgtypes "github.com/xrplevm/cosmos-explorer/apps/callisto/types"

	"github.com/xrplevm/cosmos-explorer/packages/juno/types"
)

// HandleMsg represents a message handler that stores the given message inside the proper database table
func (m *Module) HandleMsg(
	index int, msg types.Message, tx *types.Transaction) error {
	// Save message type
	err := m.db.SaveMessageType(msgtypes.NewMessageType(
		msg.GetType(),
		utils.GetModuleNameFromTypeURL(msg.GetType()),
		utils.GetMsgFromTypeURL(msg.GetType()),
		tx.Height))

	if err != nil {
		return err
	}

	return nil
}
