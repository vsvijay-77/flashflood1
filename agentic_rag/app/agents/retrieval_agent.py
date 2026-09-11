from app.rag.retriever import RAGRetriever

class RetrievalAgent:
    def __init__(self):
        self.retriever = RAGRetriever()
        
    def process(self, query: str, loc_filter: dict | None = None) -> tuple[str, list[str]]:
        chunks = self.retriever.retrieve(query, loc_filter)
        context = self.retriever.format_for_llm(chunks)
        sources = list(set([c['metadata'].get('document', 'Unknown') for c in chunks]))
        return context, sources
