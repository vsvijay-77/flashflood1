import { beforeEach, expect, it, vi } from "vitest";
const db=vi.hoisted(() => ({select:vi.fn(),eq:vi.fn(),delete:vi.fn(),from:vi.fn()}));
vi.mock("@/lib/supabase",()=>({supabase:{from:db.from}}));
import { deleteArea } from "./deleteArea";
beforeEach(()=>{vi.resetAllMocks(); db.from.mockReturnValue(db); db.delete.mockReturnValue(db); db.eq.mockReturnValue(db);});
it("surfaces Supabase deletion failures instead of hiding the area",async()=>{
 db.select.mockResolvedValue({data:null,error:new Error("denied")});
 await expect(deleteArea("a","Area")).rejects.toThrow("denied");
});
it("does not report success when permissions prevent deleting any row",async()=>{
 db.select.mockResolvedValue({data:[],error:null});
 await expect(deleteArea("a","Area")).rejects.toThrow("not deleted");
});
