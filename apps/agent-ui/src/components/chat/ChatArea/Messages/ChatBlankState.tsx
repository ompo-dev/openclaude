'use client'

const ChatBlankState = () => {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <div className="text-center">
        <div className="mb-2 text-sm text-muted">Nenhuma mensagem</div>
        <div className="text-xs text-muted">
          Comece uma conversa enviando uma mensagem
        </div>
      </div>
    </div>
  )
}

export default ChatBlankState
